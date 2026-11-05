// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toPlankBox, useHourlySeed } from "./hero";

function Probe() {
  const seed = useHourlySeed();
  return <span>{seed === null ? "skip" : "seeded"}</span>;
}

// The seed a fresh mount (one page visit) gets at the given wall-clock time.
const seedAt = (iso: string) => {
  vi.setSystemTime(new Date(iso));
  const { result, unmount } = renderHook(() => useHourlySeed());
  const seed = result.current;
  unmount();
  return seed;
};

describe("useHourlySeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("is null on the server so seeded queries stay skipped during SSR", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>skip</span>");
  });

  it("gives every visit in the same hour the same seed", () => {
    const early = seedAt("2026-10-30T10:00:00.000Z");
    const late = seedAt("2026-10-30T10:59:59.999Z");
    expect(early).not.toBeNull();
    expect(late).toBe(early);
  });

  it("moves to a new seed in the next hour", () => {
    const before = seedAt("2026-10-30T10:59:59.999Z");
    const after = seedAt("2026-10-30T11:00:00.000Z");
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("keeps one seed for the whole mount, even across the hour boundary", () => {
    vi.setSystemTime(new Date("2026-10-30T10:59:59.000Z"));
    const { result, rerender } = renderHook(() => useHourlySeed());
    const first = result.current;
    vi.setSystemTime(new Date("2026-10-30T11:30:00.000Z"));
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("toPlankBox", () => {
  const puzzle = { title: "Harbour", pieceCount: 1000, brand: "Ravensburger" };

  it("textures the box with the small rendition when there is one", () => {
    const box = toPlankBox(
      {
        ...puzzle,
        image: "https://cdn.test/original",
        thumbUrl: "https://cdn.test/480",
      },
      0,
    );
    expect(box.cover).toBe("https://cdn.test/480");
  });

  it("falls back to the original before renditions exist, and to no cover without box art", () => {
    expect(
      toPlankBox({ ...puzzle, image: "https://cdn.test/original" }, 0).cover,
    ).toBe("https://cdn.test/original");
    expect(toPlankBox({ ...puzzle, image: null }, 0).cover).toBeUndefined();
  });
});
