import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FittedPlank, JigPlank } from "./plank";

describe("JigPlank", () => {
  it("hides the decorative box labels from assistive technology", () => {
    const html = renderToStaticMarkup(
      <JigPlank
        boxes={[{ series: "Natuur", title: "Boslicht", pieceCount: 1000 }]}
      />,
    );
    expect(html).toContain("Boslicht");
    expect(html).toMatch(/^<div aria-hidden="true"/);
  });
});

describe("FittedPlank", () => {
  it("pads the plank by what it paints past its box, so fitting cuts nothing off", () => {
    const html = renderToStaticMarkup(
      <FittedPlank depth={16} boxes={[{ title: "Boslicht" }]} />,
    );
    // Top face (depth), end cap (16 overhang + 40 shelf depth), lip + shadow (16 + 27), overhang.
    expect(html).toContain("padding:16px 56px 43px 16px");
  });

  // What the first paint reserves has to match what the browser lays out, or the page moves at
  // hydration. Measured on the home and about shelves at 360, 390 and 430.
  it("reserves the size the plank will take up", () => {
    const html = renderToStaticMarkup(
      <FittedPlank
        depth={14}
        boxes={[
          { title: "Boslicht", width: 100 },
          { title: "Amsterdam", width: 96 },
          { cover: "/cover.webp", title: "Dorpsstraat", width: 134 },
        ]}
      />,
    );
    // Width: 16 + 54 (fit padding), 92 (plank padding), 330 (boxes), 2 gaps of 30.
    // Height: 14 + 43 (fit padding), 14 (top face), 144 (the tallest box: no cover).
    expect(html).toContain("aspect-ratio:552 / 215");
  });

  it("counts a cover's estimated height and a box's own size", () => {
    const html = renderToStaticMarkup(
      <FittedPlank
        depth={14}
        boxes={[{ cover: "/cover.webp", width: 140 }, { height: 60 }]}
      />,
    );
    // Width: 70 + 92 + 140 + 116 (the default) + 30. Height: 57 + 14 + 100 (140 / 1.4).
    expect(html).toContain("aspect-ratio:448 / 171");
  });
});
