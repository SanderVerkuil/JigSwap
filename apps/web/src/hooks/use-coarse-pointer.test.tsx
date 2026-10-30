import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCoarsePointer } from "./use-coarse-pointer";

function Probe() {
  return <span>{useCoarsePointer() ? "touch" : "mouse"}</span>;
}

describe("useCoarsePointer", () => {
  it("renders as a fine pointer on the server without touching window", () => {
    // Node test env: `window` is undefined, so any client-snapshot read would throw.
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>mouse</span>");
  });
});
