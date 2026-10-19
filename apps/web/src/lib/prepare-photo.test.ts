// @vitest-environment happy-dom
// happy-dom cannot decode images or draw on a canvas, so these tests stand in
// a fake <img> and 2D context. The real decode/re-encode on PNG, JPEG,
// EXIF-rotated phone photos and odd MIME types was checked in real browsers
// (headless Chrome, Firefox default/resistFingerprinting, Helium).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasCanBeTrusted, preparePhoto } from "./prepare-photo";

// What the fake browser decodes the next file as (null: cannot decode).
let decoded: { width: number; height: number } | null;
let drawn: { width: number; height: number } | undefined;

class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  private url = "";
  get src() {
    return this.url;
  }
  set src(url: string) {
    this.url = url;
    queueMicrotask(() => {
      this.complete = true;
      if (decoded) {
        this.naturalWidth = decoded.width;
        this.naturalHeight = decoded.height;
        this.onload?.();
      } else this.onerror?.();
    });
  }
  decode(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.src = this.url;
      this.onload = resolve;
      this.onerror = () => reject(new Error("EncodingError"));
    });
  }
}

const fakeContext = (canvas: HTMLCanvasElement) => ({
  canvas,
  fillStyle: "",
  fillRect: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  rotate: () => {},
  scale: () => {},
  drawImage: () => {
    drawn = { width: canvas.width, height: canvas.height };
  },
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
  }),
  putImageData: (image: { data: Uint8ClampedArray }) => {
    written = Array.from(image.data);
  },
  getImageData: () => ({ data: Uint8ClampedArray.from(readBack(written)) }),
});

let written: number[] = [];
// Privacy browsers change canvas read-back: Helium, Brave and Safari add a
// little noise; Firefox resistFingerprinting returns random bytes, and then
// toBlob encodes random bytes too.
const noised = (data: number[]) => data.map((value, i) => value + (i % 3));
const scrambled = (data: number[]) => data.map((value) => (value + 97) % 256);
let readBack: (data: number[]) => number[];

let toBlobType: string | null;

beforeEach(() => {
  decoded = { width: 800, height: 600 };
  drawn = undefined;
  toBlobType = "image/jpeg";
  readBack = noised;
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return fakeContext(this) as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement["getContext"],
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    callback: BlobCallback,
  ) {
    setTimeout(() =>
      callback(toBlobType ? new Blob(["jpeg"], { type: toBlobType }) : null),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = (type: string, name = "photo") =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

describe("preparePhoto", () => {
  it("re-encodes a PNG to JPEG even when canvas read-back is noised", async () => {
    const prepared = await preparePhoto(file("image/png", "photo.png"));
    expect(prepared.file.type).toBe("image/jpeg");
    expect(prepared).toMatchObject({ width: 800, height: 600 });
    expect(drawn).toEqual({ width: 800, height: 600 });
  });

  it("re-encodes a JPEG even when canvas read-back is noised", async () => {
    const prepared = await preparePhoto(file("image/jpeg", "photo.jpg"));
    expect(prepared.file.type).toBe("image/jpeg");
    expect(prepared).toMatchObject({ width: 800, height: 600 });
  });

  it("caps the long edge at 1600 px, keeping the aspect ratio", async () => {
    // A 4032x3024 phone photo with EXIF orientation 6 decodes upright.
    decoded = { width: 3024, height: 4032 };
    const prepared = await preparePhoto(file("image/jpeg", "IMG_0001.jpg"));
    expect(prepared).toMatchObject({ width: 1200, height: 1600 });
    expect(drawn).toEqual({ width: 1200, height: 1600 });
  });

  it("converts files whose type is empty or image/jpg", async () => {
    await expect(preparePhoto(file(""))).resolves.toMatchObject({
      width: 800,
    });
    await expect(preparePhoto(file("image/jpg"))).resolves.toMatchObject({
      width: 800,
    });
  });

  it("re-encodes when canvas read-back is exact", async () => {
    readBack = (data) => data;
    await expect(preparePhoto(file("image/png"))).resolves.toMatchObject({
      width: 800,
    });
  });

  it("hands back the original, never noise, when canvas read-back is scrambled", async () => {
    readBack = scrambled;
    decoded = { width: 3024, height: 4032 };
    const picked = file("image/png", "IMG_0001.png");

    const prepared = await preparePhoto(picked);

    expect(drawn).toBeUndefined();
    expect(prepared.reencoded).toBe(false);
    // The original bytes at their decoded (upright, unscaled) size; the server strips them.
    expect(new Uint8Array(await prepared.file.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(prepared.file.type).toBe("image/png");
    expect(prepared).toMatchObject({ width: 3024, height: 4032 });
  });

  it("types the original by its magic bytes, not the picker's claim", async () => {
    readBack = scrambled;
    const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0]);
    const named = (content: Uint8Array, type: string) =>
      new File([content as BlobPart], "photo", { type });

    const cases: [Uint8Array, string, string][] = [
      [bytes(0xff, 0xd8, 0xff, 0xe0), "", "image/jpeg"],
      [bytes(0xff, 0xd8, 0xff, 0xe1), "image/jpg", "image/jpeg"],
      [bytes(0x89, 0x50, 0x4e, 0x47), "image/jpeg", "image/png"],
      [new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "), "", "image/webp"],
    ];
    for (const [content, claimed, expected] of cases) {
      const prepared = await preparePhoto(named(content, claimed));
      expect(prepared.file.type).toBe(expected);
    }
  });

  it("re-encoded photos say so", async () => {
    await expect(preparePhoto(file("image/png"))).resolves.toMatchObject({
      reencoded: true,
    });
  });

  it("rejects a file the browser cannot decode", async () => {
    decoded = null;
    await expect(preparePhoto(file("image/heic"))).rejects.toThrow();
  });

  it("hands back the original when the canvas yields no JPEG", async () => {
    toBlobType = null;
    await expect(preparePhoto(file("image/png"))).resolves.toMatchObject({
      reencoded: false,
      width: 800,
      height: 600,
    });
  });
});

describe("canvasCanBeTrusted", () => {
  it("trusts an exact or slightly noised read-back", () => {
    readBack = (data) => data;
    expect(canvasCanBeTrusted()).toBe(true);
    readBack = noised;
    expect(canvasCanBeTrusted()).toBe(true);
  });

  it("distrusts a scrambled read-back", () => {
    readBack = scrambled;
    expect(canvasCanBeTrusted()).toBe(false);
  });

  it("distrusts a browser without a 2D canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(canvasCanBeTrusted()).toBe(false);
  });
});
