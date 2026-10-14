import { downloadBlob } from '@/lib/backup';
import type { DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';

// Saving a board as a picture or a one-page PDF. The PDF is written here, around a JPEG of the
// board, so no PDF library is needed: PDF readers decode JPEG (DCTDecode) themselves.

// CSS pixels to PDF points (1/72 inch), and the largest page PDF readers accept (200 inches).
const POINTS_PER_PX = 0.75;
const MAX_PAGE_POINTS = 14400;

/** A JPEG's size in pixels and its number of color components, read from its frame header. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG');
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    const marker = bytes[at + 1];
    // Markers without a length: fill bytes, restart markers, start and end of image.
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { at += marker === 0xff ? 1 : 2; continue; }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    // Start-of-frame markers: C0 to CF, apart from DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8], components: bytes[at + 9] };
    }
    at += 2 + length;
  }
  throw new Error('JPEG has no frame header');
}

/** A one-page PDF showing the JPEG, the page sized to the image at `pixelRatio` pixels per CSS pixel. */
export function jpegToPdf(jpeg: Uint8Array, pixelRatio = 1): Blob {
  const { width, height, components } = jpegInfo(jpeg);
  const scale = Math.min(POINTS_PER_PX / pixelRatio, MAX_PAGE_POINTS / Math.max(width, height));
  const pageWidth = +(width * scale).toFixed(2);
  const pageHeight = +(height * scale).toFixed(2);
  const colorSpace = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
  const drawing = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (body: string) => { offsets.push(length); add(`${offsets.length} 0 obj\n${body}\nendobj\n`); };

  add('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets.push(length);
  add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  add(jpeg);
  add('\nendstream\nendobj\n');
  object(`<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`);

  const xref = length;
  add(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

/** A file name from the board's title, without characters file systems refuse. */
export function exportFileName(title: string, extension: string) {
  const name = title.split('\n')[0].replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return `${name || 'Board'}.${extension}`;
}

/** Saves the whole board as a PNG or a PDF. False when the board is empty. */
export async function saveBoardAs(handle: DrawingCanvasHandle | null, format: 'png' | 'pdf', title: string): Promise<boolean> {
  const image = await handle?.exportImage(format === 'pdf' ? 'jpeg' : 'png');
  if (!image) return false;
  const blob = format === 'pdf' ? jpegToPdf(new Uint8Array(await image.blob.arrayBuffer()), image.pixelRatio) : image.blob;
  downloadBlob(blob, exportFileName(title, format));
  return true;
}
