// @vitest-environment happy-dom
// The app's one Toaster keeps toasts clear of the phone chrome: above the bottom tab bar and its
// raised "+", below the mobile top bar for top toasts, in the app font, with real-size buttons.
// The offsets are CSS expressions over the bars' published heights, so they are asserted as text.
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster } from "./sonner";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
});

// Sonner adds a raised toast on the next tick.
async function raise() {
  act(() => {
    toast("A new version of JigSwap is available", {
      id: "probe",
      duration: Infinity,
      action: { label: "Reload", onClick: () => {} },
      cancel: { label: "Not now", onClick: () => {} },
    });
  });
  return waitFor(() => {
    const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    if (!list) throw new Error("no toaster list rendered");
    return list;
  });
}

describe("Toaster", () => {
  it("lifts bottom toasts above the phone tab bar and its raised button", async () => {
    render(<Toaster />);
    const list = await raise();
    for (const name of ["--mobile-offset-bottom", "--offset-bottom"]) {
      const value = list.style.getPropertyValue(name);
      expect(value).toContain("var(--mobile-tab-bar-height, 0px)");
      // The raised "+" overhang only counts while the bar exists.
      expect(value).toContain("min(var(--mobile-tab-bar-height, 0px), 12px)");
    }
  });

  it("drops top toasts below the mobile top bar", async () => {
    render(<Toaster />);
    const list = await raise();
    for (const name of ["--mobile-offset-top", "--offset-top"]) {
      expect(list.style.getPropertyValue(name)).toContain(
        "var(--mobile-top-bar-height, 0px)",
      );
    }
  });

  it("keeps sonner's side gaps", async () => {
    render(<Toaster />);
    const list = await raise();
    expect(list.style.getPropertyValue("--mobile-offset-left")).toBe("16px");
    expect(list.style.getPropertyValue("--offset-right")).toBe("24px");
  });

  it("uses the app font and full-size action buttons", async () => {
    render(<Toaster />);
    const list = await raise();
    expect(list.style.fontFamily).toBe("var(--font-sans)");
    const reload = [...list.querySelectorAll("button")].find(
      (button) => button.textContent === "Reload",
    );
    const notNow = [...list.querySelectorAll("button")].find(
      (button) => button.textContent === "Not now",
    );
    for (const button of [reload, notNow]) {
      expect(button?.className).toContain("!h-9");
      expect(button?.className).toContain("pointer-coarse:!h-11");
    }
  });
});
