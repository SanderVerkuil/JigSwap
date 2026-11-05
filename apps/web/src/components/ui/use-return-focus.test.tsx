// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";
import { resolveReturnFocusTarget } from "./use-return-focus";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// The primitives label their close button through the app catalogue.
const wrapper = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {children}
  </IntlProvider>
);

const mount = (html: string) => {
  document.body.insertAdjacentHTML("beforeend", html);
};

describe("resolveReturnFocusTarget", () => {
  it("returns a plain focused element", () => {
    mount(`<button id="b">Open</button>`);
    const button = document.getElementById("b");
    expect(resolveReturnFocusTarget(button)).toBe(button);
  });

  it("maps a menu item to the trigger that labels its menu", () => {
    mount(
      `<button id="trigger">⋯</button>
       <div role="menu" aria-labelledby="trigger"><div role="menuitem" id="item">Log</div></div>`,
    );
    expect(resolveReturnFocusTarget(document.getElementById("item"))).toBe(
      document.getElementById("trigger"),
    );
  });

  it("follows a submenu back to the top-level trigger", () => {
    mount(
      `<button id="trigger">⋯</button>
       <div role="menu" aria-labelledby="trigger"><div role="menuitem" id="sub-trigger">More</div></div>
       <div role="menu" aria-labelledby="sub-trigger"><div role="menuitem" id="item">Log</div></div>`,
    );
    expect(resolveReturnFocusTarget(document.getElementById("item"))).toBe(
      document.getElementById("trigger"),
    );
  });

  it("ignores body and a missing element", () => {
    expect(resolveReturnFocusTarget(document.body)).toBeNull();
    expect(resolveReturnFocusTarget(null)).toBeNull();
  });

  it("ignores an element that is no longer in the document", () => {
    const detached = document.createElement("button");
    expect(resolveReturnFocusTarget(detached)).toBeNull();
  });

  it("ignores a menu item whose trigger is gone", () => {
    mount(
      `<div role="menu" aria-labelledby="missing"><div role="menuitem" id="item">Log</div></div>`,
    );
    expect(
      resolveReturnFocusTarget(document.getElementById("item")),
    ).toBeNull();
  });
});

// A dialog opened by state (palette, What's new, dropdown items) has no Radix Trigger to return to.
function Harness({
  kind,
  moveFocusOnClose,
}: {
  kind: "dialog" | "sheet" | "alert";
  moveFocusOnClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const onOpenChange = setOpen;
  const elsewhere = useRef<HTMLButtonElement>(null);
  // Something else (e.g. the route announcer on a new page) takes focus once the dialog has
  // closed, before Radix's deferred close-focus runs.
  useEffect(() => {
    if (!open && moveFocusOnClose) elsewhere.current?.focus();
  }, [open, moveFocusOnClose]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <button type="button" id="elsewhere" ref={elsewhere}>
        Elsewhere
      </button>
      {kind === "dialog" && (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Body</DialogDescription>
          </DialogContent>
        </Dialog>
      )}
      {kind === "sheet" && (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent>
            <SheetTitle>Title</SheetTitle>
            <SheetDescription>Body</SheetDescription>
          </SheetContent>
        </Sheet>
      )}
      {kind === "alert" && (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogDescription>Body</AlertDialogDescription>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

const pressEscape = () =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

describe.each(["dialog", "sheet", "alert"] as const)(
  "%s content without a trigger",
  (kind) => {
    it("returns focus to the element that was focused when it opened", async () => {
      render(<Harness kind={kind} />, { wrapper });
      const opener = screen.getByRole("button", { name: "Opener" });
      opener.focus();
      act(() => opener.click());
      await waitFor(() =>
        expect(
          document.activeElement?.closest("[role=dialog],[role=alertdialog]"),
        ).not.toBeNull(),
      );
      pressEscape();
      await waitFor(() => expect(document.activeElement).toBe(opener));
    });

    it("leaves focus alone when something else took it while closing", async () => {
      render(<Harness kind={kind} moveFocusOnClose />, { wrapper });
      const opener = screen.getByRole("button", { name: "Opener" });
      opener.focus();
      act(() => opener.click());
      await waitFor(() =>
        expect(
          document.activeElement?.closest("[role=dialog],[role=alertdialog]"),
        ).not.toBeNull(),
      );
      pressEscape();
      expect(document.activeElement?.id).toBe("elsewhere");
      // Give Radix's deferred unmount focus a chance to run.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(document.activeElement?.id).toBe("elsewhere");
    });
  },
);

// The What's-new and welcome dialogs pick their own initial focus; the report and block dialogs
// return focus to a ref of their own.
function CallerHandlers({ ownReturn }: { ownReturn?: boolean }) {
  const [open, setOpen] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const own = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <button type="button" ref={own}>
        Own target
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            primary.current?.focus();
          }}
          onCloseAutoFocus={
            ownReturn
              ? (event) => {
                  event.preventDefault();
                  own.current?.focus();
                }
              : undefined
          }
        >
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
          <button type="button" ref={primary}>
            Primary
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("DialogContent with its own focus handlers", () => {
  it("still returns focus when the caller picks the initial focus", async () => {
    render(<CallerHandlers />, { wrapper });
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    act(() => opener.click());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Primary" }),
      ),
    );
    pressEscape();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("lets a caller that handles close focus itself win", async () => {
    render(<CallerHandlers ownReturn />, { wrapper });
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    act(() => opener.click());
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Primary"),
    );
    pressEscape();
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Own target"),
    );
  });
});
