// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { EditSolveButton, isEditClosed } from "./edit-solve-button";

// The server reports until when each solve can be edited (listMyCompletions.editableUntil). The
// Edit button follows it, so it never opens a form whose save the server refuses.

const toasts = vi.hoisted(() => ({ messages: [] as string[] }));
vi.mock("sonner", () => ({
  toast: (message: string) => toasts.messages.push(message),
}));

const NOW = Date.UTC(2026, 9, 30, 12);
const HOUR = 60 * 60 * 1000;

const renderButton = (
  editableUntil: number | null | undefined,
  onEdit: () => void,
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <EditSolveButton editableUntil={editableUntil} onEdit={onEdit} />
    </IntlProvider>,
  );

beforeEach(() => {
  toasts.messages = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("isEditClosed", () => {
  it("is closed only once the reported deadline has passed", () => {
    expect(isEditClosed(NOW - 1, NOW)).toBe(true);
    expect(isEditClosed(NOW, NOW)).toBe(false); // the deadline itself is still editable
    expect(isEditClosed(NOW + HOUR, NOW)).toBe(false);
  });

  it("never closes a solve without a deadline, or when an older server reports none", () => {
    expect(isEditClosed(null, NOW)).toBe(false);
    expect(isEditClosed(undefined, NOW)).toBe(false);
  });
});

describe("EditSolveButton", () => {
  it("opens the edit form while the solve can still be edited", () => {
    const onEdit = vi.fn();
    renderButton(NOW + HOUR, onEdit);
    const button = screen.getByRole("button", { name: "Edit" });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("stays enabled for a solve in progress and for an older server", () => {
    const onEdit = vi.fn();
    renderButton(null, onEdit);
    renderButton(undefined, onEdit);
    for (const button of screen.getAllByRole("button", { name: "Edit" })) {
      expect(button.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("is unavailable after the deadline and says why instead of opening the form", () => {
    const onEdit = vi.fn();
    const closedAt = Date.UTC(2026, 9, 28, 23); // 29 Oct, 00:00 in Amsterdam
    renderButton(closedAt, onEdit);
    const button = screen.getByRole("button", { name: "Edit" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const reason =
      "Editing closed on Oct 29, 2026, 12:00 AM. You can edit a solve until 24 hours after its end date.";
    // The reason is the button's description (hover tooltip and screen readers).
    expect(button.getAttribute("title")).toBe(reason);
    fireEvent.click(button);
    expect(onEdit).not.toHaveBeenCalled();
    // A tap (touch has no hover) gets the same reason.
    expect(toasts.messages).toEqual([reason]);
  });

  it("re-checks the deadline when clicked, so a window that closed on screen is not offered", () => {
    const onEdit = vi.fn();
    renderButton(NOW + HOUR, onEdit);
    vi.setSystemTime(NOW + 2 * HOUR);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(toasts.messages).toHaveLength(1);
  });

  it("explains it in Dutch", () => {
    renderButton(Date.UTC(2026, 9, 28, 23), vi.fn(), "nl");
    const button = screen.getByRole("button", { name: "Bewerken" });
    expect(button.getAttribute("title")).toBe(
      "Bewerken was mogelijk tot 29 okt 2026, 00:00. Je kunt een voltooiing tot 24 uur na de einddatum bewerken.",
    );
  });
});
