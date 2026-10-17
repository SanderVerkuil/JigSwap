import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useClientSeed } from "./hero";

function Probe() {
  const seed = useClientSeed();
  return <span>{seed === null ? "skip" : "seeded"}</span>;
}

describe("useClientSeed", () => {
  it("is null on the server so seeded queries stay skipped during SSR", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>skip</span>");
  });
});
