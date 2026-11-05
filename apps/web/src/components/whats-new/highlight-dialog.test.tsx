// @vitest-environment happy-dom
import type { WhatsNewEntry } from "@/whats-new/types";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { WhatsNewHighlight } from "./highlight-dialog";

const mocks = vi.hoisted(() => ({
  unreadIds: undefined as string[] | undefined,
  entriesLoaded: 0,
  markSeen: vi.fn(() => Promise.resolve(null)),
  entry: (id: string, title: string, highlight: boolean): WhatsNewEntry => ({
    id,
    publishedAt: 0,
    category: "feature",
    highlight,
    notify: false,
    content: {
      en: { title, summary: `${title} summary`, html: "", fallback: false },
      nl: { title, summary: `${title} summary`, html: "", fallback: true },
    },
  }),
}));

// Newest first, like the generated manifest. Only `highlight` entries can open the modal.
vi.mock("@jigswap/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jigswap/contracts")>()),
  WHATS_NEW_MANIFEST: [
    { id: "plain", publishedAt: 3, highlight: false, notify: false },
    { id: "big", publishedAt: 2, highlight: true, notify: true },
    { id: "older-big", publishedAt: 1, highlight: true, notify: false },
  ],
}));

// The entry bodies: loaded only when the modal is about to open.
vi.mock("./entries", () => {
  mocks.entriesLoaded++;
  return {
    WHATS_NEW_ENTRIES: [
      mocks.entry("plain", "Plain", false),
      mocks.entry("big", "Big news", true),
      mocks.entry("older-big", "Older big news", true),
    ],
  };
});

vi.mock("./use-whats-new-state", () => ({
  useWhatsNewState: () => ({ unreadIds: mocks.unreadIds, tours: [] }),
}));
vi.mock("@/compat/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: () => mocks.markSeen,
}));
vi.mock("./tour-launcher", () => ({
  useTourLauncher: () => ({ startTour: vi.fn() }),
}));

const renderHighlight = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <WhatsNewHighlight />
    </IntlProvider>,
  );

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// In order: the first case must run before anything has loaded the entries module.
describe("WhatsNewHighlight", () => {
  it("loads no entry bodies and opens nothing without an unread highlight", () => {
    vi.useFakeTimers();
    mocks.unreadIds = ["plain"];
    renderHighlight();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.entriesLoaded).toBe(0);
  });

  it("opens the newest unread highlight from the manifest, loading its body on demand", async () => {
    mocks.unreadIds = ["plain", "older-big", "big"];
    renderHighlight();
    const dialog = await screen.findByRole("dialog", {}, { timeout: 2_000 });
    expect(dialog.textContent).toContain("Big news");
    expect(mocks.entriesLoaded).toBe(1);
  });
});
