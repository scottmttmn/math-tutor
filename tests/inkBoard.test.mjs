import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import load from './load-typescript.mjs';

// tldraw's schema package holds the same b64Vecs as tldraw itself, without the editor and React.
const tlschema = createRequire(import.meta.url)('@tldraw/tlschema');
const { b64Vecs } = tlschema;
const loaded = new Map();
const model = load('src/lib/inkBoard/model.ts', {}, loaded);
const edits = load('src/lib/inkBoard/edits.ts', {}, loaded);
const { GridIndex, strokesHitByPath, itemsInLasso, insidePolygon } = load('src/lib/inkBoard/hitTest.ts', {}, loaded);
const { drawBoard, drawBoardStroke, tilesFor } = load('src/lib/inkBoard/render.ts', {}, loaded);
const { boardFromTldraw, boardFromLegacyStrokes } = load('src/lib/inkBoard/fromTldraw.ts', { tldraw: tlschema }, loaded);

const line = (id, x0, y0, x1, y1, extra = {}) => ({ id, tool: 'pen', color: 'black', width: 3, points: [x0, y0, 0.5, x1, y1, 0.5], ...extra });
const board = (strokes, images = []) => ({ ...model.emptyBoard(), strokes, images });

test('points are stored rounded, a missing pressure as medium', () => {
  const points = [];
  model.pushPoint(points, 10.04, 20.06, 0.333);
  model.pushPoint(points, 1, 2, 0);
  assert.deepEqual(points, [10, 20.1, 0.33, 1, 2, 0.5]);
});

test('a stroke\'s bounds include its widest ink; work means strokes or a picture other than the problem', () => {
  assert.deepEqual(model.strokeBounds(line('a', 10, 10, 20, 30)), { minX: 7.9, minY: 7.9, maxX: 22.1, maxY: 32.1 });
  const problem = { id: 'p', x: 0, y: 0, w: 10, h: 10, src: 'data:', problem: true };
  assert.equal(model.hasWork(board([], [problem])), false);
  assert.equal(model.hasWork(board([], [{ ...problem, problem: undefined }])), true);
  assert.equal(model.hasWork(board([line('a', 0, 0, 1, 1)])), true);
});

test('the page grows to fit work beyond its sides or top, and otherwise stays the same', () => {
  const page = { left: 0, top: 0, width: 960 };
  assert.equal(model.pageAround(page, { minX: 100, minY: 100, maxX: 500, maxY: 5000 }), page);
  assert.deepEqual(model.pageAround(page, { minX: -100, minY: -50, maxX: 1000, maxY: 10 }), { left: -132, top: -82, width: 1164 });
});

test('edits make new boards and keep untouched strokes; undo and redo step through them', () => {
  const a = line('a', 0, 0, 10, 0);
  const b = line('b', 0, 50, 10, 50);
  let history = edits.startHistory(model.emptyBoard());
  history = edits.commit(history, edits.addItems(history.board, [a, b]));
  const moved = edits.moveItems(history.board, new Set(['b']), 5, 5);
  assert.equal(moved.strokes[0], a);
  assert.deepEqual(moved.strokes[1].points, [5, 55, 0.5, 15, 55, 0.5]);
  history = edits.commit(history, moved);
  history = edits.commit(history, edits.removeItems(history.board, new Set(['a'])));
  assert.deepEqual(history.board.strokes.map((s) => s.id), ['b']);
  // Removing what isn't there, or a move by nothing, is no step at all.
  assert.equal(edits.commit(history, edits.removeItems(history.board, new Set(['zzz']))), history);
  assert.equal(edits.commit(history, edits.moveItems(history.board, new Set(['b']), 0, 0)), history);
  assert.equal(edits.commit(history, edits.moveItems(history.board, new Set(['gone']), 5, 5)), history);
  history = edits.undo(edits.undo(history));
  assert.deepEqual(history.board.strokes.map((s) => s.points), [a.points, b.points]);
  history = edits.redo(history);
  assert.deepEqual(history.board.strokes[1].points, [5, 55, 0.5, 15, 55, 0.5]);
  // A new step drops what could be redone.
  history = edits.commit(history, edits.addItems(history.board, [line('c', 0, 0, 1, 1)]));
  assert.equal(edits.redo(history), history);
});

test('undo keeps at most the last hundred steps', () => {
  let history = edits.startHistory(model.emptyBoard());
  for (let i = 0; i < edits.UNDO_LIMIT + 20; i++) history = edits.commit(history, edits.addItems(history.board, [line(`s${i}`, i, 0, i, 10)]));
  assert.equal(history.past.length, edits.UNDO_LIMIT);
});

test('changed bounds cover what was added, removed and moved, and nothing else', () => {
  const a = line('a', 0, 0, 10, 0);
  const b = line('b', 500, 500, 510, 500);
  const before = board([a, b]);
  assert.equal(edits.changedBounds(before, before), null);
  const after = edits.moveItems(before, new Set(['b']), 0, 100);
  assert.deepEqual(edits.changedBounds(before, after), { minX: 497.9, minY: 497.9, maxX: 512.1, maxY: 602.1 });
  const removed = edits.removeItems(before, new Set(['a']));
  assert.deepEqual(edits.changedBounds(before, removed), model.strokeBounds(a));
});

test('the eraser takes strokes it passes over, including between its samples and between theirs', () => {
  const a = line('a', 0, 100, 200, 100);
  const b = line('b', 0, 300, 200, 300);
  const dot = { id: 'dot', tool: 'pen', color: 'black', width: 3, points: [400, 400, 0.5] };
  const current = board([a, b, dot]);
  const index = new GridIndex();
  index.update(current);
  // A fast vertical sweep sampled only above and below the first line.
  assert.deepEqual([...strokesHitByPath(current, index, [100, 50, 100, 150], 6)], ['a']);
  assert.deepEqual([...strokesHitByPath(current, index, [100, 80, 100, 90], 6)], []);
  assert.deepEqual([...strokesHitByPath(current, index, [405, 400], 6)], ['dot']);
});

test('the index follows a changed board: moved strokes are found where they went, removed ones not at all', () => {
  const a = line('a', 0, 0, 100, 0);
  let current = board([a]);
  const index = new GridIndex();
  index.update(current);
  current = edits.moveItems(current, new Set(['a']), 0, 1000);
  index.update(current);
  assert.deepEqual([...index.query({ minX: 0, minY: -5, maxX: 100, maxY: 5 })], []);
  assert.deepEqual([...index.query({ minX: 0, minY: 995, maxX: 100, maxY: 1005 })], ['a']);
  index.update(edits.removeItems(current, new Set(['a'])));
  assert.deepEqual([...index.query({ minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 })], []);
});

test('a lasso takes strokes mostly inside it and pictures by their middle, never the problem', () => {
  const inside = line('in', 10, 10, 20, 10);
  const half = { ...line('half', 50, 10, 150, 10), points: [50, 10, 0.5, 90, 10, 0.5, 150, 10, 0.5, 160, 10, 0.5] };
  const outside = line('out', 300, 300, 310, 300);
  const picture = { id: 'pic', x: 20, y: 20, w: 20, h: 20, src: 'data:' };
  const problem = { ...picture, id: 'problem', problem: true };
  const current = board([inside, half, outside], [picture, problem]);
  const index = new GridIndex();
  index.update(current);
  const lasso = [0, 0, 100, 0, 100, 100, 0, 100];
  assert.equal(insidePolygon(50, 50, lasso), true);
  assert.equal(insidePolygon(150, 50, lasso), false);
  assert.deepEqual([...itemsInLasso(current, index, lasso)].sort(), ['half', 'in', 'pic']);
});

/** A context that records what is drawn. */
function recorder() {
  const calls = [];
  const context = new Proxy({}, {
    get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])),
    set: (target, name, value) => { calls.push([`${String(name)}=`, value]); target[name] = value; return true; },
  });
  return { context, calls };
}

test('an even-pressure stroke is one smooth path; a pressed one goes piece by piece at its widths', () => {
  const even = { id: 'e', tool: 'pen', color: 'black', width: 3, points: [0, 0, 0.5, 10, 0, 0.5, 20, 10, 0.5] };
  let { context, calls } = recorder();
  drawBoardStroke(context, even);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 1);
  assert.deepEqual(calls.find(([name]) => name === 'lineWidth='), ['lineWidth=', 3]);
  const pressed = { ...even, points: [0, 0, 0, 10, 0, 1, 20, 10, 0.5] };
  ({ context, calls } = recorder());
  drawBoardStroke(context, pressed);
  assert.deepEqual(calls.filter(([name]) => name === 'lineWidth=').map(([, width]) => +width.toFixed(2)), [1.8, 4.2, 3]);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 3);
});

test('the board draws pictures, then highlights, then pen ink, only within the area asked for', () => {
  const pen = line('pen', 0, 0, 10, 0);
  const far = line('far', 0, 5000, 10, 5000);
  const highlight = { ...line('hl', 0, 0, 10, 0), tool: 'highlighter', width: 20 };
  const picture = { id: 'pic', x: 0, y: 0, w: 10, h: 10, src: 'data:' };
  const { context, calls } = recorder();
  drawBoard(context, board([pen, far, highlight], [picture]), new Map([['pic', 'IMG']]), { minX: 0, minY: 0, maxX: 100, maxY: 100 });
  const order = calls.filter(([name]) => name === 'drawImage' || name === 'strokeStyle=' || name === 'globalAlpha=');
  assert.deepEqual(order.slice(0, 3), [['drawImage', 'IMG', 0, 0, 10, 10], ['strokeStyle=', model.INK_COLORS.black], ['globalAlpha=', model.HIGHLIGHT_ALPHA]]);
  assert.equal(calls.filter(([name]) => name === 'stroke').length, 2);
  assert.deepEqual(tilesFor({ minX: 0, minY: 1000, maxX: 10, maxY: 2100 }), [0, 1, 2]);
});

// A tldraw document as the app saves it: the page, pen strokes as useBooxPen and tldraw's draw
// tool make them, a highlight, a locked problem picture, a turned group and shapes with no ink equivalent.
function tldrawDocument() {
  const record = (id, type, rest) => [id, { id, typeName: 'shape', type, x: 0, y: 0, rotation: 0, index: 'a1', parentId: 'page:page', isLocked: false, opacity: 1, meta: {}, ...rest }];
  const draw = (points, props = {}) => ({
    color: 'black', fill: 'none', dash: 'solid', size: 's', isComplete: true, isClosed: false, isPen: true, scale: 1, scaleX: 1, scaleY: 1,
    segments: [{ type: 'free', path: b64Vecs.encodePoints(points, 3), dim: 3 }], ...props,
  });
  return {
    schema: {},
    store: Object.fromEntries([
      ['page:page', { id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1', meta: {} }],
      ['asset:problem', { id: 'asset:problem', typeName: 'asset', type: 'image', props: { src: 'data:image/png;base64,AAA', w: 200, h: 100 } }],
      record('shape:problem', 'image', { x: 10, y: -150, index: 'a0', isLocked: true, meta: { problemImage: true }, props: { assetId: 'asset:problem', w: 100, h: 50, crop: null, flipX: false, flipY: false } }),
      record('shape:ink', 'draw', { x: 100, y: 200, index: 'a2', props: draw([{ x: 0, y: 0, z: 0.2 }, { x: 10, y: 5, z: 0.8 }]) }),
      record('shape:pressed', 'draw', { x: 0, y: 0, index: 'a3', props: draw([{ x: 0, y: 0, z: 0.2 }, { x: 10, y: 0, z: 0.9 }], { dash: 'draw', size: 'm', color: 'light-blue' }) }),
      record('shape:mouse', 'draw', { x: 0, y: 0, index: 'a4', props: { ...draw([], { isPen: false, scale: 2, size: 'l' }), segments: [{ type: 'straight', path: b64Vecs.encodePoints2D([{ x: 0, y: 0 }, { x: 30, y: 40 }]), dim: 2 }] } }),
      record('shape:hl', 'highlight', { x: 0, y: 300, index: 'a1V', props: { color: 'yellow', size: 'm', isPen: false, isComplete: true, scale: 1, scaleX: 1, scaleY: 1, segments: [{ type: 'free', path: b64Vecs.encodePoints2D([{ x: 0, y: 0 }, { x: 50, y: 0 }]), dim: 2 }] } }),
      record('shape:group', 'group', { x: 500, y: 500, rotation: Math.PI / 2, index: 'a5', props: {} }),
      record('shape:inGroup', 'draw', { x: 10, y: 0, index: 'a1', parentId: 'shape:group', props: draw([{ x: 0, y: 0, z: 0.5 }, { x: 10, y: 0, z: 0.5 }]) }),
      record('shape:box', 'geo', { x: 0, y: 600, index: 'a6', props: { geo: 'rectangle', w: 100, h: 100 } }),
      record('shape:words', 'text', { x: 0, y: 800, index: 'a7', props: {} }),
    ]),
  };
}

test('a tldraw board converts ink, highlights, pictures and groups in drawing order, and names what it couldn\'t', () => {
  const { board: converted, leftovers } = boardFromTldraw(tldrawDocument());
  assert.deepEqual(leftovers, ['shape:box', 'shape:words']);
  assert.deepEqual(converted.strokes.map((s) => s.id), ['hl', 'ink', 'pressed', 'mouse', 'inGroup']);
  const [hl, ink, pressed, mouse, inGroup] = converted.strokes;
  // Solid ink keeps an even width, as tldraw drew it; positions are on the page.
  assert.deepEqual(ink, { id: 'ink', tool: 'pen', color: 'black', width: 3, points: [100, 200, 0.5, 110, 205, 0.5] });
  // tldraw's "draw" dash showed a pen's pressure; its colors fold into the board's few.
  assert.deepEqual(pressed.points.filter((_, i) => i % 3 === 2), [0.2, 0.9]);
  assert.equal(pressed.color, 'blue');
  assert.equal(pressed.width, 4.5);
  // A straight segment keeps its two ends; the shape's scale widens it.
  assert.deepEqual(mouse.points, [0, 0, 0.5, 30, 40, 0.5]);
  assert.equal(mouse.width, 12);
  assert.deepEqual(hl, { id: 'hl', tool: 'highlighter', color: 'red', width: 26.88, points: [0, 300, 0.5, 50, 300, 0.5] });
  // Turned a quarter with its group about the group's origin (500, 500).
  assert.deepEqual(inGroup.points, [500, 510, 0.5, 500, 520, 0.5]);
  assert.deepEqual(converted.images, [{ id: 'problem', x: 10, y: -150, w: 100, h: 50, src: 'data:image/png;base64,AAA', problem: true }]);
  // The page grows above the picture, which sat above y = 0, and left of the highlight's ink at x = 0.
  assert.deepEqual(converted.page, { left: -45.44, top: -182, width: 1005.44 });
});

test('a cropped or turned picture and see-through ink stay leftovers, and an empty document is an empty board', () => {
  const document = tldrawDocument();
  document.store['shape:problem'].props.crop = { topLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 1 } };
  document.store['shape:problem'].meta = {};
  assert.ok(boardFromTldraw(document).leftovers.includes('shape:problem'));
  // See-through ink, or ink in a see-through group, is kept as a picture too.
  document.store['shape:ink'].opacity = 0.5;
  document.store['shape:group'].opacity = 0.5;
  const { board: rest, leftovers } = boardFromTldraw(document);
  assert.ok(leftovers.includes('shape:ink') && leftovers.includes('shape:inGroup'));
  assert.deepEqual(rest.strokes.map((s) => s.id), ['hl', 'pressed', 'mouse']);
  const empty = boardFromTldraw({ schema: {}, store: { 'page:page': { id: 'page:page', typeName: 'page', index: 'a1' } } });
  assert.deepEqual(empty, { board: model.emptyBoard(), leftovers: [] });
});

test('pre-tldraw strokes convert with their erasing applied', () => {
  const converted = boardFromLegacyStrokes([
    { tool: 'pen', color: '#1E40AF', thickness: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { tool: 'eraser', color: '#ffffff', thickness: 10, points: [{ x: 50, y: -20 }, { x: 50, y: 20 }] },
  ]);
  assert.equal(converted.strokes.length, 2);
  assert.ok(converted.strokes.every((stroke) => stroke.color === 'blue' && stroke.width === 2));
  // The cut falls around x = 50.
  assert.ok(converted.strokes[0].points.at(-3) < 50 && converted.strokes[1].points[0] > 50);
});

const camera = load('src/lib/inkBoard/camera.ts');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('the camera fits the page\'s width, zooms from there up to four times, and stays within its sides and top', () => {
  const page = { left: 0, top: 0, width: 960 };
  const view = { w: 1000, h: 800 };
  const fit = camera.fitCamera(page, view, 100);
  near(fit.z, (1000 - 32) / 960);
  near(fit.x, -16 / fit.z);
  assert.equal(fit.y, 100);
  // Never zoomed out past the page, nor in past four times writing scale.
  near(camera.zoomAbout(fit, 0.5, { x: 500, y: 400 }, page, view).z, fit.z);
  near(camera.zoomAbout(fit, 10, { x: 500, y: 400 }, page, view).z, fit.z * 4);
  // Zooming keeps the point under the fingers where it is.
  const zoomed = camera.zoomAbout(fit, 2, { x: 500, y: 400 }, page, view);
  const before = camera.toBoard(fit, 500, 400);
  const after = camera.toBoard(zoomed, 500, 400);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  // Not above the page's top (less the gutter), nor past its sides; no bottom.
  const clamped = camera.clampCamera({ x: -500, y: -500, z: zoomed.z }, page, view);
  near(clamped.y, -16 / zoomed.z);
  near(clamped.x, -16 / zoomed.z);
  assert.equal(camera.clampCamera({ ...zoomed, y: 1e6 }, page, view).y, 1e6);
  near(camera.clampCamera({ x: 5000, y: 0, z: zoomed.z }, page, view).x, 960 + 16 / zoomed.z - 1000 / zoomed.z);
});

test('a copy is new items beside the originals, never the problem picture, and one undo step', () => {
  const problem = { id: 'p', x: 0, y: 0, w: 10, h: 10, src: 'data:', problem: true };
  const picture = { id: 'q', x: 50, y: 50, w: 10, h: 10, src: 'data:' };
  const before = board([line('a', 10, 10, 20, 30), line('b', 100, 100, 110, 110)], [problem, picture]);
  let n = 0;
  const { board: after, ids } = edits.copyItems(before, new Set(['a', 'p', 'q']), 24, 24, () => `copy${(n += 1)}`);
  assert.deepEqual([...ids], ['copy1', 'copy2']);
  assert.equal(after.strokes.length, 3);
  assert.deepEqual(after.strokes[2].points, [34, 34, 0.5, 44, 54, 0.5]);
  assert.equal(after.strokes[0], before.strokes[0]);
  assert.deepEqual(after.images.map((image) => [image.id, image.x, image.problem]), [['p', 0, true], ['q', 50, undefined], ['copy2', 74, undefined]]);
  assert.equal(edits.copyItems(before, new Set(['gone']), 24, 24, () => 'x').board, before);
  assert.equal(edits.copyItems(before, new Set(['p']), 24, 24, () => 'x').board, before);
});
