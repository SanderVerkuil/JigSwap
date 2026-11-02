// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

// The photo viewer holds a (never opened, own photos) report form that needs a Convex client.
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => vi.fn(),
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

  const editRequest = (over: Partial<CompletionRowData>) => {
    renderRow(row(over));
    const menu = openMenu("Actions for Tirol");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }));
    return requests[0] as Extract<CompletionDialogRequest, { kind: "edit" }>;
  };

  it("prefills the edit form with a time the member typed", () => {
    const sameDay = Date.UTC(2026, 9, 29);
    const request = editRequest({
      startDate: sameDay,
      endDate: sameDay,
      completionTimeMinutes: 200,
    });
    expect(request.timeMinutes).toBe(200);
  });

  it("leaves the time empty when the stored duration is only the one-day default", () => {
    const sameDay = Date.UTC(2026, 9, 29);
    const request = editRequest({
      startDate: sameDay,
      endDate: sameDay,
      completionTimeMinutes: 1440,
    });
    expect(request.timeMinutes).toBeUndefined();
  });

  it("leaves the time empty when the stored duration is only the span between the dates", () => {
    const request = editRequest({
      startDate: Date.UTC(2026, 9, 27),
      endDate: Date.UTC(2026, 9, 29),
      completionTimeMinutes: 2880,
    });
    expect(request.timeMinutes).toBeUndefined();
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

describe("CompletionRow photos", () => {
  const withPhotos = row({
    thumbnailUrl: "https://files.test/cover.jpg",
    photoItems: [
      { url: "https://files.test/one.jpg", pending: false },
      { url: "https://files.test/two.jpg", pending: true },
    ],
  });

  it("makes each photo a button named for the solve", () => {
    renderRow(withPhotos);
    expect(
      screen.getByRole("button", { name: "Tirol, photo 1 of 2" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Tirol, photo 2 of 2, pending review",
      }),
    ).toBeDefined();
  });

  it("opens a tapped photo in the viewer, pages with the arrow keys and returns focus", async () => {
    renderRow(withPhotos);
    const second = screen.getByRole("button", {
      name: "Tirol, photo 2 of 2, pending review",
    });
    second.focus();
    fireEvent.click(second);
    const dialog = await screen.findByRole("dialog", {
      name: "Your photo of Tirol (pending review)",
    });
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      "https://files.test/two.jpg",
    );
    // The member's own photos: nothing to report.
    expect(screen.queryByRole("button", { name: "Report photo" })).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(
      await screen.findByRole("dialog", { name: "Your photo of Tirol" }),
    ).toBeDefined();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it("keeps the cover as a plain link, without a hover-only preview", () => {
    renderRow(withPhotos);
    const cover = screen
      .getAllByRole("link", { name: "Tirol" })
      .find((link) => link.querySelector("img"));
    expect(cover?.getAttribute("href")).toBe("/puzzles/puzzle-1");
    // A Radix tooltip trigger carries data-state; the cover no longer is one.
    expect(cover?.hasAttribute("data-state")).toBe(false);
    for (const photo of screen.getAllByRole("button", { name: /photo \d/ })) {
      expect(photo.hasAttribute("data-state")).toBe(false);
    }
  });

  it("names the photos in Dutch", () => {
    renderRow(withPhotos, "nl");
    expect(
      screen.getByRole("button", {
        name: "Tirol, foto 2 van 2, wacht op controle",
      }),
    ).toBeDefined();
  });
});
