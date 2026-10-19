import { describe, expect, it } from "vitest";
import { exportChoice } from "./export-choice";

describe("exportChoice", () => {
  it("bakes through the canvas when read-back can be trusted, edited or not", () => {
    expect(
      exportChoice({ canvasTrusted: true, rotation: 0, cropChanged: false }),
    ).toBe("canvas");
    expect(
      exportChoice({ canvasTrusted: true, rotation: 90, cropChanged: true }),
    ).toBe("canvas");
  });

  it("hands back the original when the canvas is scrambled and nothing was edited", () => {
    expect(
      exportChoice({ canvasTrusted: false, rotation: 0, cropChanged: false }),
    ).toBe("original");
  });

  it.each([
    ["rotated", 90, false],
    ["rotated a little", -1, false],
    ["cropped", 0, true],
    ["rotated and cropped", 180, true],
  ])(
    "blocks the scrambled bake when the photo was %s",
    (_name, rotation, cropChanged) => {
      expect(
        exportChoice({ canvasTrusted: false, rotation, cropChanged }),
      ).toBe("blocked");
    },
  );
});
