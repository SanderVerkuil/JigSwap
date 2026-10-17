import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useIsMobile } from "./use-mobile";

function Probe() {
  return <span>{useIsMobile() ? "mobile" : "desktop"}</span>;
}

describe("useIsMobile", () => {
  it("renders as not-mobile on the server without touching window", () => {
    // Node test env: `window` is undefined, so any client-snapshot read would throw.
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>desktop</span>");
  });
});
