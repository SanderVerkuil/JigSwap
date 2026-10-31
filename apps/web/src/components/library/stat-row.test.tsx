// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatRow } from "./stat-row";

// The open stat row lays its stats out in columns on phones and in one line from md up, with a
// hairline between neighbours. A phone row that holds three stats needs its dividers after the
// first and second stat of every row of three, not after every odd one.

const stats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `Stat ${i}`,
    value: String(i),
  }));

const cells = (container: HTMLElement) =>
  Array.from(container.firstElementChild?.children ?? []) as HTMLElement[];

// Phone divider = a plain border-l; desktop-only divider = md:border-l.
const phoneDivider = (el: HTMLElement) => el.classList.contains("border-l");
const desktopOnlyDivider = (el: HTMLElement) =>
  !el.classList.contains("border-l") && el.classList.contains("md:border-l");

afterEach(cleanup);

describe("StatRow", () => {
  it("keeps two columns on phones by default", () => {
    const { container } = render(<StatRow stats={stats(5)} />);
    expect(container.firstElementChild?.classList).toContain("grid-cols-2");
    const row = cells(container);
    expect(row.map(phoneDivider)).toEqual([false, true, false, true, false]);
    expect(row.map(desktopOnlyDivider)).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
  });

  it("puts three stats on a phone row when asked, divided within each row", () => {
    const { container } = render(<StatRow stats={stats(5)} mobileCols={3} />);
    expect(container.firstElementChild?.classList).toContain("grid-cols-3");
    expect(container.firstElementChild?.classList).not.toContain("grid-cols-2");
    const row = cells(container);
    // Rows of three: [0 | 1 | 2] [3 | 4].
    expect(row.map(phoneDivider)).toEqual([false, true, true, false, true]);
    // The first stat of the second phone row still gets its divider once the row is one line.
    expect(row.map(desktopOnlyDivider)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
  });
});
