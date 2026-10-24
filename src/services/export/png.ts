/**
 * Embeds UTF-8 text in a PNG as an iTXt chunk (PNG spec §11.3.4.5), inserted right after IHDR.
 * Image viewers ignore it; tools such as `exiftool` or Python's Pillow (`img.text`) can read it.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function addPngTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((b, i) => png[i] !== b)) throw new Error('Not a PNG file.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrLength = view.getUint32(8);
  const insertAt = 8 + 12 + ihdrLength;
  const enc = new TextEncoder();
  const key = enc.encode(keyword.slice(0, 79));
  const body = enc.encode(text);
  // keyword \0 compression-flag compression-method language-tag \0 translated-keyword \0 text
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key, 0);
  data.set(body, key.length + 5);
  const type = enc.encode('iTXt');
  const chunk = new Uint8Array(12 + data.length);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, 4);
  cv.setUint32(8 + data.length, crc32(crcInput));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(png.subarray(insertAt), insertAt + chunk.length);
  return out;
}

export async function canvasToPngWithMetadata(canvas: HTMLCanvasElement, metadata: object): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob)
    throw new Error('The browser could not encode the image (it may exceed the maximum canvas size).');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob(
    [addPngTextChunk(bytes, 'LatentScope', JSON.stringify(metadata)) as Uint8Array<ArrayBuffer>],
    { type: 'image/png' },
  );
}
