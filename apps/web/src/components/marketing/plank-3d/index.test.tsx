import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JigPlank3D } from "./index";

describe("JigPlank3D", () => {
  it("server-renders only the CSS fallback without probing window/WebGL", () => {
    // Node test env: no window/document, so a client-snapshot read would throw.
    const html = renderToStaticMarkup(<JigPlank3D rows={[]} />);
    expect(html).not.toContain("<canvas");
    expect(html).toContain('aria-hidden="true"');
  });
});
