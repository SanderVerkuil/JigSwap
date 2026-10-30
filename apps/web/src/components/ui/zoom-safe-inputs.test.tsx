// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Command, CommandInput } from "./command";
import { Input } from "./input";
import { Textarea } from "./textarea";

// iOS zooms the page into any focused field whose text is under 16px (UX-71). The shared fields
// keep 16px (text-base) on touch at every width, including the 820px touch tablet, and only drop
// to 14px from md up on a pointer that is not coarse (mouse/trackpad desktops).

afterEach(cleanup);

const classes = (el: Element) => el.getAttribute("class")?.split(/\s+/) ?? [];

describe("zoom-safe text fields", () => {
  it.each([
    ["Input", () => render(<Input aria-label="Field" />)],
    ["Textarea", () => render(<Textarea aria-label="Field" />)],
    [
      "CommandInput",
      () =>
        render(
          <Command>
            <CommandInput aria-label="Field" />
          </Command>,
        ),
    ],
  ])("%s is 16px on touch and 14px only on a non-touch md+ screen", (_, r) => {
    r();
    const list = classes(screen.getByLabelText("Field"));
    expect(list).toContain("text-base");
    expect(list).toContain("md:not-pointer-coarse:text-sm");
    // No unconditional or width-only small size that would also apply on a touch tablet.
    expect(list).not.toContain("text-sm");
    expect(list).not.toContain("md:text-sm");
  });
});
