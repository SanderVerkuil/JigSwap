// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { LeaveStepDialog } from "./leave-step-dialog";
import type { StepCommitSnapshot } from "./step-commit";

afterEach(cleanup);

const open = (
  work: StepCommitSnapshot,
  locale: "en" | "nl" = "en",
  handlers = { onKeep: vi.fn(), onDiscard: vi.fn() },
) => {
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <LeaveStepDialog open work={work} {...handlers} />
    </IntlProvider>,
  );
  return handlers;
};

describe("LeaveStepDialog", () => {
  it("asks before dropping the picks, with Keep editing focused first", () => {
    open({ kind: "puzzles", count: 3, ready: true });
    const dialog = screen.getByRole("alertdialog", {
      name: "Leave without saving?",
    });
    expect(dialog.textContent).toContain(
      "The 3 puzzles you picked haven't been added to your shelf yet.",
    );
    const keep = screen.getByRole("button", { name: "Keep editing" });
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    // The safe choice is the default: Radix focuses Cancel on open.
    expect(document.activeElement).toBe(keep);
  });

  it("names what each step would lose, in English and Dutch", () => {
    open({ kind: "solves", count: 1, ready: true });
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "The puzzle you ticked hasn't been logged yet.",
    );
    cleanup();
    open({ kind: "profile", count: 1, ready: true }, "nl");
    const dialog = screen.getByRole("alertdialog", {
      name: "Weggaan zonder op te slaan?",
    });
    expect(dialog.textContent).toContain(
      "Je nieuwe locatie is nog niet opgeslagen.",
    );
    expect(
      screen.getByRole("button", { name: "Verder bewerken" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Niet opslaan" })).toBeTruthy();
  });

  it("keeps editing on Keep editing and on Escape", () => {
    const first = open({ kind: "puzzles", count: 2, ready: true });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    });
    expect(first.onKeep).toHaveBeenCalled();
    expect(first.onDiscard).not.toHaveBeenCalled();
    cleanup();

    const second = open({ kind: "puzzles", count: 2, ready: true });
    act(() => {
      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    });
    expect(second.onKeep).toHaveBeenCalled();
    expect(second.onDiscard).not.toHaveBeenCalled();
  });

  it("discards only on Discard", () => {
    const { onKeep, onDiscard } = open({
      kind: "solves",
      count: 2,
      ready: true,
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("gives focus back to where the member was when they keep editing", async () => {
    const work = { kind: "puzzles", count: 1, ready: true } as const;
    const ui = (open: boolean) => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <button type="button">Finish later</button>
        <LeaveStepDialog
          open={open}
          work={work}
          onKeep={() => {}}
          onDiscard={() => {}}
        />
      </IntlProvider>
    );
    const view = render(ui(false));
    const origin = screen.getByRole("button", { name: "Finish later" });
    origin.focus();
    view.rerender(ui(true));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Keep editing" }),
    );
    view.rerender(ui(false));
    // Radix hands focus back on a timer after the dialog unmounts.
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });
});
