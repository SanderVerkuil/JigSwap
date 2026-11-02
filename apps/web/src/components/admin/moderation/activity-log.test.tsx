// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { ActivityLog, MODERATION_ACTIVITY_KINDS } from "./activity-log";

const mocks = vi.hoisted(() => ({
  paginated: vi.fn<(ref: unknown, args: unknown) => unknown>(),
}));

vi.mock("@/gateway", () => ({ gateway: { admin: {} } }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (ref: unknown, args: unknown) =>
    mocks.paginated(ref, args),
}));
// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (acc, [key, value]) => acc.replace(`$${key}`, value),
      to,
    );
    const query = search ? `?${new URLSearchParams(search)}` : "";
    return (
      <a href={`${path}${query}`} {...rest}>
        {children}
      </a>
    );
  },
}));

const NOW = new Date("2026-10-18T12:00:00Z");

const row = (overrides: Record<string, unknown>) => ({
  actionId: "a1",
  kind: "definition_approved",
  actorId: "u_admin",
  actorName: "Ada",
  targetLabel: "Starry Night",
  targetId: "agg-1",
  target: null,
  at: NOW.getTime() - 60_000,
  ...overrides,
});

const page = (results: unknown[], status = "Exhausted") => ({
  results,
  status,
  loadMore: vi.fn(),
  isLoading: false,
});

const changes = { kind: [] as (string | undefined)[], clearActor: 0 };
beforeEach(() => {
  mocks.paginated.mockReset();
  changes.kind = [];
  changes.clearActor = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderLog = (
  props: { kind?: string; actorId?: string } = {},
  locale: "en" | "nl" = "en",
) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
      now={NOW}
    >
      <ActivityLog
        emptyTitle="All clear"
        {...props}
        onKindChange={(kind) => changes.kind.push(kind)}
        onClearActor={() => (changes.clearActor += 1)}
      />
    </IntlProvider>,
  );

const lastArgs = () => mocks.paginated.mock.lastCall?.[1];
const hrefOf = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("ActivityLog", () => {
  it("shows a retryable error, not the loading state, when a page fails", () => {
    // The boundary logs what it caught; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.paginated.mockImplementation(() => {
      throw new Error("Forbidden");
    });
    renderLog();

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(en.admin.moderation.activity.loading)).toBeNull();

    // Retry subscribes again.
    mocks.paginated.mockReset().mockReturnValue(page([row({})]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Starry Night")).toBeTruthy();
  });

  it("shows the loading state while the first page loads", () => {
    mocks.paginated.mockReturnValue(page([], "LoadingFirstPage"));
    renderLog();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(en.admin.moderation.activity.loading)).toBeTruthy();
  });

  it("links the actor and the target to their pages", () => {
    mocks.paginated.mockReturnValue(
      page([
        row({
          actionId: "a1",
          target: { kind: "puzzle", puzzleId: "p1" },
        }),
        row({
          actionId: "a2",
          kind: "role_granted",
          targetLabel: "Bob",
          targetId: "clerk_bob",
          target: { kind: "member", userId: "u_bob" },
        }),
        row({
          actionId: "a3",
          kind: "report_warned",
          targetLabel: "Otto",
          target: { kind: "report", reportId: "r1" },
        }),
        row({
          actionId: "a4",
          kind: "photo_auto_rejected",
          actorId: null,
          actorName: null,
          targetLabel: "Box art",
          target: null,
        }),
      ]),
    );
    renderLog();

    for (const actor of screen.getAllByRole("link", { name: "Ada" })) {
      expect(actor.getAttribute("href")).toBe("/admin/users/u_admin");
    }
    expect(hrefOf("Starry Night")).toBe("/admin/puzzles/p1");
    expect(hrefOf("Bob")).toBe("/admin/users/u_bob");
    expect(hrefOf("Otto")).toBe("/admin/moderation?tab=reports&report=r1");

    // The automated pipeline and a target without a page stay plain text.
    const system = screen.getByText("System");
    expect(system.closest("a")).toBeNull();
    expect(screen.getByText("Box art").closest("a")).toBeNull();
    expect(system.closest("li")?.textContent).toContain(
      "System auto-flagged a photo on Box art",
    );
  });

  it("names a member whose account is gone with a localized in-sentence 'a deleted member' (SEC-57)", () => {
    mocks.paginated.mockReturnValue(
      page([
        row({
          actionId: "a1",
          kind: "report_warned",
          targetLabel: "Deleted member",
          targetMemberDeleted: true,
          target: { kind: "report", reportId: "r1" },
        }),
        row({
          actionId: "a2",
          kind: "role_revoked",
          targetLabel: "Deleted member",
          targetMemberDeleted: true,
          target: null,
        }),
        row({
          actionId: "a3",
          kind: "role_granted",
          targetLabel: "Otto",
          target: { kind: "member", userId: "u2" },
        }),
      ]),
    );
    const sentences = () =>
      screen
        .getAllByRole("listitem")
        .map((item) => item.querySelector("p")?.textContent);

    renderLog({}, "nl");
    expect(sentences()).toEqual([
      "Ada waarschuwde een verwijderd lid na een rapportage",
      "Ada trok de beheerdersrol van een verwijderd lid in",
      "Ada maakte Otto beheerder",
    ]);
    // The report still links; a role row without a member has nothing to link to.
    expect(hrefOf("een verwijderd lid")).toBe(
      "/admin/moderation?tab=reports&report=r1",
    );
    cleanup();

    renderLog();
    expect(sentences()).toEqual([
      "Ada warned a deleted member after a report",
      "Ada removed the admin role from a deleted member",
      "Ada made Otto an admin",
    ]);
  });

  it("links the actor in the sentences of the kinds stamped since SEC-56", () => {
    mocks.paginated.mockReturnValue(
      page([
        row({
          actionId: "a1",
          kind: "category_created",
          targetLabel: "Landscapes",
        }),
        row({ actionId: "a2", kind: "categories_reordered" }),
      ]),
    );
    renderLog();

    const sentences = screen
      .getAllByRole("listitem")
      .map((item) => item.querySelector("p")?.textContent);
    expect(sentences).toEqual([
      "Ada created the category Landscapes",
      "Ada reordered the catalogue categories",
    ]);
    for (const actor of screen.getAllByRole("link", { name: "Ada" })) {
      expect(actor.getAttribute("href")).toBe("/admin/users/u_admin");
    }
    expect(screen.getByText("Landscapes").closest("a")).toBeNull();
  });

  it("offers every kind as a filter, labelled in English and Dutch", () => {
    for (const kind of MODERATION_ACTIVITY_KINDS) {
      expect(en.admin.moderation.activity.kinds).toHaveProperty(kind);
      expect(nl.admin.moderation.activity.kinds).toHaveProperty(kind);
    }
    mocks.paginated.mockReturnValue(page([row({})]));
    renderLog();

    const select = screen.getByLabelText(
      "Filter by action",
    ) as HTMLSelectElement;
    expect(select.options).toHaveLength(MODERATION_ACTIVITY_KINDS.length + 1);
    expect(lastArgs()).toEqual({});
    fireEvent.change(select, { target: { value: "report_warned" } });
    expect(changes.kind).toEqual(["report_warned"]);
    fireEvent.change(select, { target: { value: "" } });
    expect(changes.kind).toEqual(["report_warned", undefined]);
  });

  it("queries the kind from the URL, and ignores one it does not know", () => {
    mocks.paginated.mockReturnValue(page([]));
    renderLog({ kind: "report_warned" });
    expect(lastArgs()).toEqual({ kind: "report_warned" });
    expect(
      (screen.getByLabelText("Filter by action") as HTMLSelectElement).value,
    ).toBe("report_warned");
    expect(
      screen.getByText(en.admin.moderation.activity.emptyFiltered),
    ).toBeTruthy();
    cleanup();

    renderLog({ kind: "bogus" });
    expect(lastArgs()).toEqual({});
    expect(screen.getByText(en.admin.moderation.activityEmpty)).toBeTruthy();
  });

  it("narrows to one admin from the URL, names them and can show everyone again", () => {
    mocks.paginated.mockReturnValue(page([row({})]));
    renderLog({ actorId: "u_admin", kind: "definition_approved" });

    expect(lastArgs()).toEqual({
      kind: "definition_approved",
      actorId: "u_admin",
    });
    expect(screen.getByText("Actions by Ada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all admins" }));
    expect(changes.clearActor).toBe(1);
  });

  it("loads more pages on request", () => {
    const more = page([row({})], "CanLoadMore");
    mocks.paginated.mockReturnValue(more);
    renderLog();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(more.loadMore).toHaveBeenCalledWith(25);
  });
});
