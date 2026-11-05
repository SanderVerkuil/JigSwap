// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CoverTile, ExchangeCover } from "./exchange-cover";

const HARBOUR = "https://cdn.example/harbour.jpg";
const TULIPS = "https://cdn.example/tulips.jpg";

const images = (root: HTMLElement) =>
  [...root.querySelectorAll("img")].map((img) => img.getAttribute("src"));

afterEach(cleanup);

describe("ExchangeCover", () => {
  it("shows the puzzle's cover with the kind as a corner badge", () => {
    const { container } = render(
      <ExchangeCover kind="loan" covers={[HARBOUR]} gradientIndex={0} />,
    );
    expect(images(container)).toEqual([HARBOUR]);
    // Decorative: the row's text names the puzzle and the kind.
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(container.querySelector("[data-kind-badge]")).not.toBeNull();
  });

  it("overlaps both covers of a swap, the first in front", () => {
    const { container } = render(
      <ExchangeCover
        kind="trade"
        covers={[HARBOUR, TULIPS]}
        gradientIndex={0}
      />,
    );
    // Back first in DOM order, so the front one paints over it.
    expect(images(container)).toEqual([TULIPS, HARBOUR]);
    expect(container.querySelector("[data-kind-badge]")).not.toBeNull();
  });

  it("keeps a placeholder for a swap's copy without a cover", () => {
    const { container } = render(
      <ExchangeCover kind="trade" covers={[null, TULIPS]} gradientIndex={0} />,
    );
    expect(images(container)).toEqual([TULIPS]);
    expect(container.querySelectorAll("[data-cover-tile]")).toHaveLength(2);
  });

  it("falls back to the kind chip when there is no cover at all", () => {
    for (const covers of [[null], [undefined], [null, null]]) {
      const { container, unmount } = render(
        <ExchangeCover kind="sale" covers={covers} gradientIndex={0} />,
      );
      expect(images(container)).toEqual([]);
      expect(container.querySelector("[data-cover-tile]")).toBeNull();
      // The chip is the kind icon itself, so no extra badge.
      expect(container.querySelector("[data-kind-badge]")).toBeNull();
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("can leave the kind out where every row is the same kind", () => {
    const { container } = render(
      <ExchangeCover
        kind="loan"
        covers={[HARBOUR]}
        gradientIndex={0}
        showKind={false}
      />,
    );
    expect(images(container)).toEqual([HARBOUR]);
    expect(container.querySelector("[data-kind-badge]")).toBeNull();
  });
});

describe("CoverTile", () => {
  it("renders the cover as a decorative image", () => {
    const { container } = render(<CoverTile url={HARBOUR} />);
    expect(images(container)).toEqual([HARBOUR]);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
