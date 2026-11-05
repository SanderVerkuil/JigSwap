// @vitest-environment happy-dom
// UX-60: every dialog fits the viewport. The content box is capped at the dynamic viewport height
// and scrolls inside itself, the footer (the dialog's actions) stays pinned while the body
// scrolls, and the close button is a real 36px target (44px on touch) whose icon stays where it
// was. Asserted through the class contract, since happy-dom does no layout.
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./dialog";

afterEach(cleanup);

function renderDialog(className?: string) {
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Dialog open>
        <DialogContent className={className}>
          <DialogTitle>Log a solve</DialogTitle>
          <DialogDescription>When did you finish?</DialogDescription>
          <DialogFooter>
            <button type="button">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IntlProvider>,
  );
}

function classesOf(element: Element | null) {
  return (element?.getAttribute("class") ?? "").split(/\s+/);
}

describe("DialogContent", () => {
  it("caps its height at the visible viewport and scrolls its own content", () => {
    renderDialog();
    const classes = classesOf(screen.getByRole("dialog"));
    expect(classes).toContain("max-h-[calc(100dvh-2rem)]");
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("overscroll-contain");
  });

  // A field can sit inside the scrollport yet under the sticky footer, where the browser sees no
  // reason to scroll to it. The padding covers the footer plus the 24px strip below it: two
  // stacked buttons on a phone, one row from sm, both at their 44px touch height.
  it("keeps a focused field clear of the sticky footer", () => {
    renderDialog();
    const classes = classesOf(screen.getByRole("dialog"));
    expect(classes).toContain("scroll-pb-32");
    expect(classes).toContain("sm:scroll-pb-20");
  });

  it("lets a dialog that manages its own height and overflow override the defaults", () => {
    renderDialog("max-h-[90vh] overflow-hidden");
    const classes = classesOf(screen.getByRole("dialog"));
    expect(classes).toContain("max-h-[90vh]");
    expect(classes).toContain("overflow-hidden");
    expect(classes).not.toContain("max-h-[calc(100dvh-2rem)]");
    expect(classes).not.toContain("overflow-y-auto");
  });

  it("gives the close button a 36px target, 44px on touch, around an unmoved icon", () => {
    renderDialog();
    const classes = classesOf(screen.getByRole("button", { name: "Close" }));
    expect(classes).toEqual(
      expect.arrayContaining([
        "grid",
        "size-9",
        "place-items-center",
        "opacity-100",
        // 6px + 18px = the icon's centre 24px from the corner, as with the old top-4/right-4.
        "top-1.5",
        "right-1.5",
        "pointer-coarse:size-11",
        "pointer-coarse:top-0.5",
        "pointer-coarse:right-0.5",
      ]),
    );
    expect(classes).not.toContain("opacity-70");
  });
});

describe("DialogFooter", () => {
  it("stays pinned to the bottom of a scrolling dialog on an opaque background", () => {
    renderDialog();
    const footer = screen.getByRole("button", { name: "Save" }).parentElement;
    const classes = classesOf(footer);
    expect(classes).toContain("sticky");
    expect(classes).toContain("bottom-0");
    expect(classes).toContain("bg-background");
    // Covers the 24px strip a sticky box leaves below itself in the padded dialog, and the gutters.
    expect(classes).toContain("shadow-[0_1.5rem_0_1.5rem_var(--background)]");
  });
});
