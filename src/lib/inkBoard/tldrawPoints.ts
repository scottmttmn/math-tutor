// The points of a stroke saved by tldraw, read without tldraw (the app no longer ships it). A
// segment's `path` is base64 of little-endian floats: the first point as float32s, then each next
// point as float16 differences from the one before; x, y and pressure, or x and y with `dim` 2.

export interface SavedPoint { x: number; y: number; z: number }

function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** An IEEE half-precision float from its 16 bits. */
export function float16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/** A segment's points; pressure 0.5 where none was saved. */
export function decodeTldrawPoints(path: string, dim: 2 | 3 = 3): SavedPoint[] {
  if (!path) return [];
  const bytes = bytesOf(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const three = dim !== 2;
  const first = three ? 12 : 8;
  if (bytes.length < first) return [];
  let x = view.getFloat32(0, true), y = view.getFloat32(4, true), z = three ? view.getFloat32(8, true) : 0.5;
  const points = [{ x, y, z }];
  const step = three ? 6 : 4;
  for (let at = first; at + step <= bytes.length; at += step) {
    x += float16(view.getUint16(at, true));
    y += float16(view.getUint16(at + 2, true));
    if (three) z += float16(view.getUint16(at + 4, true));
    points.push({ x, y, z });
  }
  return points;
}
