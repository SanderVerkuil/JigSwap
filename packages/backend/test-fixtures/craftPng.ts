import { deflateSync } from "node:zlib";

// Hand-built PNG files for the input-guard tests. Every chunk carries a valid CRC, so pngjs (the
// decoder jimp uses) reads them exactly as it would a real upload.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const u32be = (n: number) => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
];

/** One chunk: length, type, data and the CRC over type + data. */
export const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = new Uint8Array([
    ...Array.from(type, (ch) => ch.charCodeAt(0)),
    ...data,
  ]);
  return new Uint8Array([
    ...u32be(data.length),
    ...typed,
    ...u32be(crc32(typed)),
  ]);
};

/** An IHDR chunk: 8-bit RGBA unless told otherwise; `interlace` 1 is Adam7. */
export const ihdrChunk = (
  width: number,
  height: number,
  { interlace = 0 }: { interlace?: number } = {},
) =>
  pngChunk(
    "IHDR",
    new Uint8Array([...u32be(width), ...u32be(height), 8, 6, 0, 0, interlace]),
  );

// The Adam7 passes: x start, y start, x step, y step.
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * An IDAT chunk holding a fully transparent 8-bit RGBA image of the given size (every scanline
 * filter type 0, every byte 0), laid out in Adam7 passes when `interlaced`.
 */
export const transparentIdat = (
  width: number,
  height: number,
  { interlaced = false }: { interlaced?: boolean } = {},
) => {
  const rows = (w: number, h: number) => (w > 0 && h > 0 ? h * (w * 4 + 1) : 0);
  const size = interlaced
    ? ADAM7.reduce(
        (sum, [x0, y0, dx, dy]) =>
          sum +
          rows(Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)),
        0,
      )
    : rows(width, height);
  return pngChunk("IDAT", new Uint8Array(deflateSync(new Uint8Array(size))));
};

export const iendChunk = () => pngChunk("IEND", new Uint8Array());

/** The PNG signature followed by the chunks, in order. */
export const craftPng = (...chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(
    PNG_SIGNATURE.length + chunks.reduce((n, chunk) => n + chunk.length, 0),
  );
  out.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/** A valid, fully transparent 8-bit RGBA PNG of the given size. */
export const transparentPng = (
  width: number,
  height: number,
  { interlaced = false }: { interlaced?: boolean } = {},
) =>
  craftPng(
    ihdrChunk(width, height, { interlace: interlaced ? 1 : 0 }),
    transparentIdat(width, height, { interlaced }),
    iendChunk(),
  );
