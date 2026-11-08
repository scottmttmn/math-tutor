// tldraw's packed stroke points, written for test fixtures (src/lib/inkBoard/tldrawPoints.ts reads
// them): the first point as float32s, then float16 differences, little-endian, in base64.

function float16Bits(value) {
  const floats = new Float32Array(1);
  const bits = new Uint32Array(floats.buffer);
  floats[0] = value;
  const x = bits[0];
  const sign = (x >>> 16) & 0x8000;
  const exponent = ((x >>> 23) & 0xff) - 127 + 15;
  let mantissa = x & 0x7fffff;
  if (exponent <= 0) return sign | Math.round((mantissa | 0x800000) / 2 ** (14 - exponent));
  if (exponent >= 31) return sign | 0x7c00;
  mantissa = Math.round(mantissa / 0x2000);
  return sign | ((exponent << 10) + mantissa);
}

function pack(points, dim) {
  if (!points.length) return '';
  const first = dim * 4, step = dim * 2;
  const view = new DataView(new ArrayBuffer(first + (points.length - 1) * step));
  const value = (p, k) => (k === 'z' ? (p.z ?? 0.5) : p[k]);
  const keys = dim === 3 ? ['x', 'y', 'z'] : ['x', 'y'];
  keys.forEach((k, i) => view.setFloat32(i * 4, value(points[0], k), true));
  for (let n = 1; n < points.length; n++) {
    keys.forEach((k, i) => view.setUint16(first + (n - 1) * step + i * 2, float16Bits(value(points[n], k) - value(points[n - 1], k)), true));
  }
  return Buffer.from(view.buffer).toString('base64');
}

export const encodePoints = (points) => pack(points, 3);
export const encodePoints2D = (points) => pack(points, 2);
