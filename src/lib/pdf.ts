import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageRect } from '@/types';

// PDF.js and its worker, fonts and character maps are served from public/pdfjs (copied on npm
// install), so the Shelf reads PDFs offline. Loaded on first use; it needs the browser. The legacy
// build: the modern one uses JavaScript too new for some browsers (and e-ink tablets' web views).
let library: Promise<typeof import('pdfjs-dist')> | null = null;
function pdfjs() {
  library ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    return lib;
  });
  return library;
}

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdfjs/cmaps/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  }).promise;
}

/** Draws a page `width` CSS pixels wide, sharp on high-density screens. Cancel the task to stop. */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, width: number): RenderTask {
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  return page.render({ canvas, viewport });
}

async function drawPage(page: PDFPageProxy, width: number) {
  const canvas = document.createElement('canvas');
  const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport, background: 'white' }).promise;
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
const toBase64 = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1] ?? '';

/** The first page, small, for the Shelf. */
export async function renderCover(pdf: PDFDocumentProxy): Promise<Blob | null> {
  return toBlob(await drawPage(await pdf.getPage(1), 240));
}

// Wide enough that small print in a marked exercise stays legible to the tutor.
const CROP_PAGE_WIDTH = 1800;

/** PNG (base64, no data: prefix) of a marked region of a page, for the exercise's problem image. */
export async function cropPage(pdf: PDFDocumentProxy, pageNumber: number, rect: PageRect): Promise<string> {
  const page = await drawPage(await pdf.getPage(pageNumber), CROP_PAGE_WIDTH);
  const crop = document.createElement('canvas');
  const sx = Math.round(rect.x * page.width);
  const sy = Math.round(rect.y * page.height);
  crop.width = Math.max(1, Math.round(rect.width * page.width));
  crop.height = Math.max(1, Math.round(rect.height * page.height));
  crop.getContext('2d')?.drawImage(page, sx, sy, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return toBase64(crop);
}

/** A whole page as a PNG (base64), for a single problem dropped straight onto a board. */
export async function pageImage(pdf: PDFDocumentProxy, pageNumber = 1): Promise<string> {
  return toBase64(await drawPage(await pdf.getPage(pageNumber), CROP_PAGE_WIDTH));
}

/** Any image the browser can show, as a PNG (base64), since the tutor is sent PNGs. */
export async function imageFileToPng(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return toBase64(canvas);
}
