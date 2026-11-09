// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedPills } from "./segmented-pills";

const OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
] as const;

type Level = (typeof OPTIONS)[number]["value"];

const renderPills = (
  value: Level | undefined,
  onChange: (v: Level) => void = () => {},
) =>
  render(
    <SegmentedPills<Level>
      options={OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="Difficulty"
    />,
  );

const radios = () => screen.getAllByRole("radio");
const tabStops = () => radios().filter((radio) => radio.tabIndex === 0);

afterEach(cleanup);

describe("SegmentedPills", () => {
  it("makes the checked pill the group's only Tab stop", () => {
    renderPills("hard");
    expect(tabStops().map((r) => r.textContent)).toEqual(["Hard"]);
    expect(
      radios().filter((r) => r.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
  });

  it("stays keyboard-reachable through the first pill when nothing is checked", () => {
    renderPills(undefined);
    expect(
      radios().some((r) => r.getAttribute("aria-checked") === "true"),
    ).toBe(false);
    expect(tabStops().map((r) => r.textContent)).toEqual(["Easy"]);
  });

  // The 4px corner of the fields beside it (DESIGN.md Shapes), at the same height as before (not
  // shrunk to a small button); the canal fill gets a Night Link ring after dark, where Night
  // Primary alone is under 3:1 on the sheet.
  it("draws the options with the 4px corner and rings the checked one after dark", () => {
    renderPills("medium");
    for (const radio of radios()) {
      expect(radio.classList).toContain("rounded-md");
      expect(radio.classList).not.toContain("rounded-full");
      expect(radio.classList).toContain("py-2");
    }
    const checked = screen.getByRole("radio", { name: "Medium" });
    expect([...checked.classList]).toEqual(
      expect.arrayContaining(["dark:ring-1", "dark:ring-primary-text"]),
    );
    expect(screen.getByRole("radio", { name: "Easy" }).classList).not.toContain(
      "dark:ring-1",
    );
  });

  it("selects with the arrow keys from the unchecked first pill", () => {
    const onChange = vi.fn();
    renderPills(undefined, onChange);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Easy" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("medium");
  });
});
