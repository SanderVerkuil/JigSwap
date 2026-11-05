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

  it("selects with the arrow keys from the unchecked first pill", () => {
    const onChange = vi.fn();
    renderPills(undefined, onChange);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Easy" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("medium");
  });
});
