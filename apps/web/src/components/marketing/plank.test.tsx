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
    const html = renderToStaticMarkup(<FittedPlank depth={16} boxes={[]} />);
    // Top face (depth), end cap (16 overhang + 40 shelf depth), lip + shadow (16 + 27), overhang.
    expect(html).toContain("padding:16px 56px 43px 16px");
  });
});
