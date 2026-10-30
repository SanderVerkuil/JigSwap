import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JigPlank } from "./plank";

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
