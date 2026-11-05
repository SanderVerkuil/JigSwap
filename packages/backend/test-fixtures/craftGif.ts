// Hand-built GIF files for the input-guard tests, laid out the way omggif (the decoder jimp uses)
// reads a real upload: header, logical screen with a 2-colour global table, the given blocks, and
// the trailer.

const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];

/** A GIF of the given logical screen size holding `blocks`, then the trailer. */
export const craftGif = (
  width: number,
  height: number,
  ...blocks: number[][]
): Uint8Array =>
  new Uint8Array([
    ...ascii("GIF89a"),
    ...u16le(width),
    ...u16le(height),
    0x80, // a global colour table of 2 entries
    0,
    0,
    ...[0, 0, 0, 255, 255, 255],
    ...blocks.flat(),
    0x3b,
  ]);

/**
 * An image descriptor at (0, 0) of the given size and its LZW data (minimum code size 2): a clear
 * code, one pixel of colour 1, end of information.
 */
export const gifFrame = (width: number, height: number): number[] => [
  0x2c,
  ...u16le(0),
  ...u16le(0),
  ...u16le(width),
  ...u16le(height),
  0,
  2,
  2,
  0x4c,
  0x01,
  0,
];

/** A graphic control extension: one 4-byte sub-block (no transparency), then its terminator. */
export const gifControl = (): number[] => [0x21, 0xf9, 4, 0, 0, 0, 0, 0];

/** A comment extension holding `text`. */
export const gifComment = (text: string): number[] => [
  0x21,
  0xfe,
  text.length,
  ...ascii(text),
  0,
];

/** The NETSCAPE2.0 application extension browsers loop an animation by (loop forever). */
export const gifNetscapeLoop = (): number[] => [
  0x21,
  0xff,
  0x0b,
  ...ascii("NETSCAPE2.0"),
  3,
  1,
  0,
  0,
  0,
];

/** An application extension with its 11-byte identifier, then `data` as one sub-block. */
export const gifApplication = (
  identifier: string,
  data: number[],
): number[] => [
  0x21,
  0xff,
  0x0b,
  ...ascii(identifier),
  data.length,
  ...data,
  0,
];

/**
 * A GIF that reads as two different images (SEC-18). Its application extension's first
 * sub-block is 1 byte, not the 11-byte identifier, and omggif then skips a fixed 17 bytes
 * whatever the sub-blocks say. A walk by the sub-block sizes meets a 1x1 frame inside the 1x1
 * screen; omggif skips over it and decodes a frame of `hidden` size instead.
 */
export const appExtensionDifferentialGif = (hidden: {
  width: number;
  height: number;
}): Uint8Array => {
  const walked = [
    ...[0x21, 0xff, 1, 0xaa, 0], // sub-blocks: 1 byte, then the terminator
    ...gifFrame(1, 1).slice(0, 10), // the 1x1 image descriptor
    ...[2, 1, 0x2c, 0], // its data: a clear code and end of information
  ];
  // omggif reads the introducer, the label and 17 bytes: it resumes right after the walk's frame.
  if (walked.length !== 2 + 17) {
    throw new Error(`the walked blocks are ${walked.length} bytes, not 19`);
  }
  return craftGif(1, 1, walked, gifFrame(hidden.width, hidden.height));
};
