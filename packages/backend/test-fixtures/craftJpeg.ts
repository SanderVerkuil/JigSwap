// A progressive JPEG with as many scans as asked for, and hardly any bytes to show for it. Each scan
// is an AC refinement of one component, whose one Huffman code stands for a run of end-of-block
// markers long enough to cover the image, so a scan costs 28 bytes of file (at a few thousand pixels
// a side) and still makes jpeg-js walk 63 coefficients of every block. The frame is small enough for
// every guard but the one on scans.

const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];

const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16be(payload.length + 2),
  ...payload,
];

// EOB runs of 2^15 - 1 blocks: code 0 for symbol 0xE0, then fourteen extra bits of 1.
const EOB_RUN_BLOCKS = 2 ** 15 - 1;

const entropyCodedRuns = (runs: number): number[] => {
  const bits: number[] = [];
  for (let i = 0; i < runs; i++) bits.push(0, ...Array<number>(14).fill(1));
  while (bits.length % 8 !== 0) bits.push(1);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8).reduce((b, bit) => (b << 1) | bit, 0);
    out.push(byte);
    if (byte === 0xff) out.push(0x00); // stuffed
  }
  return out;
};

export const progressiveJpeg = ({
  width,
  height,
  scans,
}: {
  width: number;
  height: number;
  scans: number;
}): Uint8Array => {
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  const scan = [
    // One component (table 0), spectral 1..63, successive approximation high 1, low 0.
    ...segment(0xda, [1, 1, 0x00, 1, 63, 0x10]),
    ...entropyCodedRuns(Math.ceil(blocks / EOB_RUN_BLOCKS)),
  ];
  const bytes = [
    0xff,
    0xd8,
    ...segment(0xdb, [0, ...Array<number>(64).fill(16)]),
    ...segment(0xc2, [
      8,
      ...u16be(height),
      ...u16be(width),
      1,
      1,
      0x11, // sampled 1x1
      0,
    ]),
    // AC table 0: one code of one bit, for symbol 0xE0.
    ...segment(0xc4, [0x10, 1, ...Array<number>(15).fill(0), 0xe0]),
  ];
  for (let i = 0; i < scans; i++) bytes.push(...scan);
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
};
