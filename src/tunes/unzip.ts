// Just enough zip reading for compressed MusicXML (.mxl): the central directory, stored and
// deflated entries. Inflating uses the browser's DecompressionStream.

export async function unzip(data: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const maxBytes = 20 * 1024 * 1024;
  const bounds = (at: number, size: number) => {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || at + size > bytes.length)
      throw new Error("The .mxl archive is truncated or damaged.");
  };
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count > 1024 || view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0)
    throw new Error("This .mxl archive is too large or uses unsupported split files.");
  const decoder = new TextDecoder();
  const entries = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count; n++) {
    bounds(p, 46);
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("The .mxl archive has an invalid file index.");
    if (view.getUint16(p + 8, true) & 1) throw new Error("Encrypted .mxl archives are not supported.");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const expanded = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    bounds(p + 46, nameLen + extraLen + commentLen);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    entries.set(name, async () => {
      if (expanded > maxBytes) throw new Error("A score inside that .mxl is larger than 20 MB.");
      bounds(local, 30);
      if (view.getUint32(local, true) !== 0x04034b50) throw new Error("The .mxl archive has a damaged file entry.");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      bounds(start, size);
      const raw = bytes.slice(start, start + size);
      if (method === 0) {
        if (raw.length !== expanded) throw new Error("The .mxl archive has an invalid file size.");
        return raw;
      }
      if (method !== 8) throw new Error("Unsupported zip compression.");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxBytes || length > expanded) {
          await reader.cancel();
          throw new Error("The .mxl score exceeds its advertised size or the 20 MB limit.");
        }
        chunks.push(chunk.value);
      }
      if (length !== expanded) throw new Error("The .mxl score is incomplete.");
      const result = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    });
  }
  return entries;
}
