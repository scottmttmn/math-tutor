// A minimal ZIP writer and reader for backups: files are stored, not compressed (PDFs and PNGs are
// compressed already), and reading only handles stored entries, which is what the writer makes.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, as ZIP stores them.
function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** A ZIP of the given files (path → contents), each stored as is. */
export async function writeZip(files: Map<string, Blob>, date = new Date()): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let centralSize = 0;
  let offset = 0;
  for (const [path, blob] of files) {
    const name = encoder.encode(path);
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    centralSize += 46 + name.length;
    offset += 30 + name.length + data.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.size, true);
  end.setUint16(10, files.size, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/** The files in a ZIP this app wrote, by path. Contents are slices of the file, read when needed. */
export async function readZip(zip: Blob): Promise<Map<string, Blob>> {
  // The end record is the last 22 bytes, unless a comment follows it (up to 64 KB).
  const tail = new DataView(await zip.slice(Math.max(0, zip.size - 22 - 0xffff)).arrayBuffer());
  let endAt = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === 0x06054b50) { endAt = i; break; }
  }
  if (endAt < 0) throw new Error('Not a ZIP file');
  const count = tail.getUint16(endAt + 10, true);
  const centralSize = tail.getUint32(endAt + 12, true);
  const centralOffset = tail.getUint32(endAt + 16, true);
  const directory = new DataView(await zip.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const decoder = new TextDecoder();
  const files = new Map<string, Blob>();
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (directory.getUint32(at, true) !== 0x02014b50) throw new Error('Damaged ZIP file');
    const method = directory.getUint16(at + 10, true);
    const size = directory.getUint32(at + 20, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    const localOffset = directory.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength));
    if (method !== 0) throw new Error('Compressed ZIP entries are not supported');
    const local = new DataView(await zip.slice(localOffset, localOffset + 30).arrayBuffer());
    const dataStart = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    files.set(name, zip.slice(dataStart, dataStart + size));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
