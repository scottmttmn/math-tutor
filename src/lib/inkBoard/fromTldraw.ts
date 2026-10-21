import { b64Vecs } from 'tldraw';
import type { BoardImage, BoardInk, BoardStroke, CanvasDocument, InkColor, Stroke } from '@/types';
import { clipErasedInk } from '@/lib/legacyStrokes';
import { emptyBoard, pageAround, boardBounds, pushPoint } from './model';

// Turning a board saved by tldraw (or by the canvas before it) into an ink board. Pen and
// highlighter ink and pictures convert exactly; anything else (shapes, text, arrows, notes,
// frames, cropped or turned pictures) is reported, so the caller can keep it as a picture.

/** tldraw's draw width per size (2 × its stroke size + 1) and its highlighter's (16px × font size × 1.12). */
const DRAW_WIDTHS: Record<string, number> = { s: 3, m: 4.5, l: 6, xl: 11 };
const HIGHLIGHT_WIDTHS: Record<string, number> = { s: 20.16, m: 26.88, l: 40.32, xl: 49.28 };

/** tldraw's colors as the board's few inks. */
const COLORS: Record<string, InkColor> = {
  black: 'black', grey: 'gray', white: 'gray',
  blue: 'blue', 'light-blue': 'blue', violet: 'blue', 'light-violet': 'blue',
  red: 'red', 'light-red': 'red', orange: 'red', yellow: 'red',
  green: 'green', 'light-green': 'green',
};

/** The pre-tldraw canvas's colors (`legacyStrokes.ts`). */
const LEGACY_COLORS: Record<string, InkColor> = {
  '#000000': 'black', '#1e40af': 'blue', '#dc2626': 'red', '#16a34a': 'green', '#9333ea': 'blue', '#ea580c': 'red',
};

interface TLRecord {
  id: string;
  typeName: string;
  type?: string;
  x?: number;
  y?: number;
  rotation?: number;
  index?: string;
  parentId?: string;
  props?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

interface Segment { type: 'free' | 'straight'; path: string; dim?: 2 | 3 }

/** An affine transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Transform = [number, number, number, number, number, number];

function shapeTransform(shape: TLRecord, parent: Transform): Transform {
  const rotation = shape.rotation ?? 0;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const [a, b, c, d, e, f] = parent;
  const x = shape.x ?? 0, y = shape.y ?? 0;
  // parent ∘ translate(x, y) ∘ rotate(rotation)
  return [a * cos + c * sin, b * cos + d * sin, -a * sin + c * cos, -b * sin + d * cos, a * x + c * y + e, b * x + d * y + f];
}

const apply = (t: Transform, x: number, y: number) => ({ x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] });

export interface Conversion {
  board: BoardInk;
  /** Shapes that couldn't be converted, as tldraw shape ids, in drawing order. */
  leftovers: string[];
}

/** An ink stroke for a tldraw draw or highlight shape at `transform`. */
function inkStroke(shape: TLRecord, transform: Transform): BoardStroke | null {
  const props = shape.props ?? {};
  const highlight = shape.type === 'highlight';
  const scale = typeof props.scale === 'number' ? props.scale : 1;
  const scaleX = typeof props.scaleX === 'number' ? props.scaleX : 1;
  const scaleY = typeof props.scaleY === 'number' ? props.scaleY : 1;
  // A pen's pressure shows only in tldraw's "draw" dash; solid, dashed and dotted lines are even.
  const keepPressure = !highlight && props.isPen === true && props.dash === 'draw';
  const points: number[] = [];
  for (const segment of (props.segments as Segment[] | undefined) ?? []) {
    for (const point of b64Vecs.decodePoints(segment.path, segment.dim)) {
      const at = apply(transform, point.x * scaleX, point.y * scaleY);
      pushPoint(points, at.x, at.y, keepPressure ? (point.z ?? 0.5) : 0.5);
    }
  }
  if (points.length === 0) return null;
  const widths = highlight ? HIGHLIGHT_WIDTHS : DRAW_WIDTHS;
  const width = (widths[String(props.size)] ?? widths.s) * scale;
  return {
    id: shape.id.replace(/^shape:/, ''),
    tool: highlight ? 'highlighter' : 'pen',
    color: COLORS[String(props.color)] ?? 'black',
    width: Math.round(width * 100) / 100,
    points,
  };
}

/** An image shape that is neither turned, cropped nor flipped, with its picture. */
function inkImage(shape: TLRecord, transform: Transform, assets: Map<string, TLRecord>): BoardImage | null {
  const props = shape.props ?? {};
  const src = assets.get(String(props.assetId))?.props?.src;
  const turned = Math.abs(transform[1]) > 1e-9 || Math.abs(transform[2]) > 1e-9 || transform[0] < 0 || transform[3] < 0;
  if (typeof src !== 'string' || !src || turned || props.crop || props.flipX || props.flipY) return null;
  const w = Number(props.w), h = Number(props.h);
  if (!(w > 0 && h > 0)) return null;
  const origin = apply(transform, 0, 0);
  const problem = shape.meta?.problemImage;
  return {
    id: shape.id.replace(/^shape:/, ''),
    x: origin.x, y: origin.y, w, h, src,
    ...(problem === true || typeof problem === 'string' ? { problem } : {}),
  };
}

/** A tldraw document as an ink board, with the shapes it couldn't convert. */
export function boardFromTldraw(document: CanvasDocument): Conversion {
  const records = Object.values(document.store as Record<string, TLRecord>);
  const children = new Map<string, TLRecord[]>();
  const assets = new Map<string, TLRecord>();
  for (const record of records) {
    if (record.typeName === 'asset') assets.set(record.id, record);
    if (record.typeName !== 'shape' || !record.parentId) continue;
    const siblings = children.get(record.parentId) ?? [];
    siblings.push(record);
    children.set(record.parentId, siblings);
  }
  // tldraw's drawing order: siblings by their index (plain string order), each group's shapes in its place.
  for (const siblings of children.values()) siblings.sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0));

  const strokes: BoardStroke[] = [];
  const images: BoardImage[] = [];
  const leftovers: string[] = [];
  const visit = (shape: TLRecord, parent: Transform) => {
    const transform = shapeTransform(shape, parent);
    if (shape.type === 'group') {
      for (const child of children.get(shape.id) ?? []) visit(child, transform);
      return;
    }
    const converted = shape.type === 'draw' || shape.type === 'highlight' ? inkStroke(shape, transform)
      : shape.type === 'image' ? inkImage(shape, transform, assets) : null;
    if (!converted) leftovers.push(shape.id);
    else if ('points' in converted) strokes.push(converted);
    else images.push(converted);
    // A frame's shapes are drawn with it in the picture made of the frame; others' children are their own.
    if (shape.type !== 'frame') for (const child of children.get(shape.id) ?? []) visit(child, transform);
  };
  const pages = records.filter((record) => record.typeName === 'page').sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : 1));
  // The app has one page per board.
  for (const shape of pages.length ? children.get(pages[0].id) ?? [] : []) visit(shape, [1, 0, 0, 1, 0, 0]);

  const board = { ...emptyBoard(), strokes, images };
  return { board: { ...board, page: pageAround(board.page, boardBounds(board)) }, leftovers };
}

/** Strokes saved by the canvas before tldraw as an ink board (eraser strokes cut the ink under them). */
export function boardFromLegacyStrokes(legacy: Stroke[]): BoardInk {
  const strokes = clipErasedInk(legacy).map((stroke, index): BoardStroke => {
    const points: number[] = [];
    for (const point of stroke.points) pushPoint(points, point.x, point.y, 0.5);
    return { id: `legacy-${index}`, tool: 'pen', color: LEGACY_COLORS[stroke.color.toLowerCase()] ?? 'black', width: Math.max(1, stroke.thickness), points };
  });
  const board = { ...emptyBoard(), strokes };
  return { ...board, page: pageAround(board.page, boardBounds(board)) };
}
