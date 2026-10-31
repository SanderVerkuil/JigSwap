// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  CompletionRow,
  type CompletionDialogRequest,
  type CompletionRowData,
} from "./completion-row";

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const toasts = vi.hoisted(() => ({ messages: [] as string[] }));
vi.mock("sonner", () => ({
  toast: (message: string) => toasts.messages.push(message),
}));

// A completion log row on a phone: Review, Edit and Delete sit in a 44px "Actions for …" menu
// (Finish stays a visible button); from sm up they are icon buttons that grow to 44px on touch.

const NOW = Date.UTC(2026, 9, 30, 12);
const HOUR = 60 * 60 * 1000;

const row = (over: Partial<CompletionRowData> = {}): CompletionRowData => ({
  _id: "row-1" as CompletionRowData["_id"],
  _creationTime: NOW,
  aggregateId: "completion-1",
  userId: "user-1" as CompletionRowData["userId"],
  puzzleId: "puzzle-1" as CompletionRowData["puzzleId"],
  startDate: Date.UTC(2026, 9, 28),
  endDate: Date.UTC(2026, 9, 29),
  photos: [],
  isCompleted: true,
  createdAt: NOW,
  updatedAt: NOW,
  photoItems: [],
  thumbnailUrl: undefined,
  link: { kind: "definition", id: "puzzle-1" },
  editableUntil: NOW + HOUR,
  ...over,
});

let requests: CompletionDialogRequest[] = [];

const renderRow = (completion: CompletionRowData, locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <CompletionRow
        completion={completion}
        info={{ title: "Tirol", pieceCount: 1000 }}
        index={0}
        isLast
        onOpenDialog={(request) => requests.push(request)}
      />
    </IntlProvider>,
  );

const openMenu = (name: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
  return screen.getByRole("menu");
};

beforeEach(() => {
  requests = [];
  toasts.messages = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CompletionRow actions", () => {
  it("puts Review, Edit and Delete in a 44px menu below sm", () => {
    renderRow(row());
    const trigger = screen.getByRole("button", { name: "Actions for Tirol" });
    expect(trigger.className).toContain("size-11");
    expect(trigger.className).toContain("sm:hidden");
    const menu = openMenu("Actions for Tirol");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Review", "Edit", "Delete"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(requests).toEqual([
      { kind: "delete", completionId: "completion-1" },
    ]);
  });

  it("opens the edit form from the menu while the solve can be edited", () => {
    renderRow(row());
    const menu = openMenu("Actions for Tirol");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    expect(requests).toEqual([
      expect.objectContaining({ kind: "edit", completionId: "completion-1" }),
    ]);
  });

  it("says why instead of opening the form once the edit window has closed", () => {
    renderRow(row({ editableUntil: NOW - HOUR }));
    const menu = openMenu("Actions for Tirol");
    const edit = within(menu).getByRole("menuitem", { name: "Edit" });
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(edit);
    expect(requests).toEqual([]);
    expect(toasts.messages).toHaveLength(1);
    expect(toasts.messages[0]).toMatch(/^Editing closed on /);
  });

  it("keeps the icon buttons from sm up, 44px on touch and 8px apart", () => {
    renderRow(row());
    const icons = ["Review", "Edit", "Delete"].map((name) =>
      screen.getByRole("button", { name }),
    );
    for (const icon of icons) {
      expect(icon.className).toContain("pointer-coarse:size-11");
    }
    const group = icons[0].parentElement!;
    expect(group.className).toContain("hidden");
    expect(group.className).toContain("sm:flex");
    expect(group.className).toContain("gap-2");
    // A finished row has no Finish, so on phones the action strip takes no line of its own.
    expect(group.parentElement!.className).toMatch(/(^| )hidden( |$)/);
  });

  it("keeps Finish visible on every screen for a solve in progress", () => {
    renderRow(row({ isCompleted: false, endDate: undefined }));
    const finish = screen.getByRole("button", { name: "Finish solve" });
    expect(finish.className).not.toContain("hidden");
    fireEvent.click(finish);
    expect(requests).toEqual([
      {
        kind: "finish",
        completionId: "completion-1",
        startDate: Date.UTC(2026, 9, 28),
        puzzleTitle: "Tirol",
      },
    ]);
  });

  it("offers no menu when the row has no action", () => {
    renderRow(row({ aggregateId: undefined, puzzleId: undefined }));
    expect(
      screen.queryByRole("button", { name: "Actions for Tirol" }),
    ).toBeNull();
  });

  it("names the menu in Dutch", () => {
    renderRow(row(), "nl");
    const menu = openMenu("Acties voor Tirol");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Beoordelen", "Bewerken", "Verwijderen"]);
  });
});
