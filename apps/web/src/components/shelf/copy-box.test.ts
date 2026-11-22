import { describe, expect, it } from "vitest";
import { copyShelfBox } from "./copy-box";

const puzzle = {
  title: "De Kattenshow",
  brand: "Jumbo",
  pieceCount: 1000,
};

describe("copyShelfBox", () => {
  it("uses the copy's own cover, and opens where it's told", () => {
    const box = copyShelfBox(
      { _id: "c1", coverUrl: "https://art.example/mine.jpg", puzzle },
      "/my-puzzles/c1",
    );
    expect(box).toEqual({
      id: "c1",
      title: "De Kattenshow",
      brand: "Jumbo",
      pieceCount: 1000,
      cover: "https://art.example/mine.jpg",
      href: "/my-puzzles/c1",
    });
  });

  it("has no cover when the copy has none, and uses the copy's snapshot for a removed puzzle", () => {
    expect(
      copyShelfBox({ _id: "c2", coverUrl: null, puzzle }, "/copies/c2").cover,
    ).toBeUndefined();
    expect(
      copyShelfBox(
        {
          _id: "c3",
          puzzle: null,
          snapshot: { title: "Molen", pieceCount: 500 },
        },
        "/copies/c3",
      ),
    ).toMatchObject({ title: "Molen", pieceCount: 500, cover: undefined });
  });
});
