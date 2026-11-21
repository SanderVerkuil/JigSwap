import { describe, expect, it } from "vitest";
import { copyShelfBox } from "./copy-box";

const puzzle = {
  title: "De Kattenshow",
  brand: "Jumbo",
  pieceCount: 1000,
  images: ["https://art.example/kattenshow.jpg"],
};

describe("copyShelfBox", () => {
  it("prefers the copy's own cover to the puzzle's image, and opens where it's told", () => {
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

  it("falls back to the puzzle's image, then to the copy's snapshot for a removed puzzle", () => {
    expect(
      copyShelfBox({ _id: "c2", coverUrl: null, puzzle }, "/copies/c2").cover,
    ).toBe("https://art.example/kattenshow.jpg");
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
