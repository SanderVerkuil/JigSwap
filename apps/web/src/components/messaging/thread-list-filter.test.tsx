// @vitest-environment happy-dom
// UX-116: a long inbox gets a search box and All / People / Exchanges /
// Circles chips; a short one stays a plain list.
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import type { AnyInboxThread } from "./format";
import { ThreadList } from "./thread-list";

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

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/components/presence/presence-sharing", () => ({
  PresenceSharePrompt: () => null,
}));

const person = (id: string, name: string) => ({
  anonymous: false as const,
  member: {
    _id: id,
    _creationTime: 0,
    name,
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
  },
});

const base = (threadId: string) => ({
  threadId,
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 1,
});

const dm = (threadId: string, name: string): AnyInboxThread => ({
  ...base(threadId),
  subject: {
    kind: "dm",
    otherMember: person(`u_${threadId}`, name),
    profileHandle: threadId,
  },
});

const exchange = (
  threadId: string,
  puzzleTitle: string,
  partner: string,
): AnyInboxThread => ({
  ...base(threadId),
  subject: {
    kind: "exchange",
    exchangeId: `ex_${threadId}`,
    exchangeType: "trade",
    puzzleTitle,
    otherMember: person(`u_${threadId}`, partner),
    profileHandle: null,
  },
});

const circle = (threadId: string, name: string): AnyInboxThread => ({
  ...base(threadId),
  subject: {
    kind: "circle",
    circleId: `circle_${threadId}`,
    name,
    memberCount: 4,
    memberPreview: [],
  },
});

// 12 threads: 6 people, 3 exchanges, 3 circles.
const INBOX: AnyInboxThread[] = [
  dm("zoe", "Zoë"),
  exchange("harbour", "Night Harbour", "Mara"),
  circle("club", "Puzzle Club"),
  dm("anna", "Anna"),
  dm("bas", "Bas"),
  exchange("castle", "Neuschwanstein", "Dirk"),
  circle("family", "Family"),
  dm("carla", "Carla"),
  dm("eva", "Eva"),
  exchange("tulips", "Tulip Fields", "Femke"),
  circle("wasgij", "Wasgij Fans"),
  dm("gijs", "Gijs"),
];

const renderList = (inbox: AnyInboxThread[], locale: "en" | "nl" = "en") => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.conversation.getMyInbox, {}).queryKey,
    inbox,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ThreadList />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const rows = () =>
  within(screen.getByRole("navigation", { name: "Conversations" }))
    .queryAllByRole("link")
    .map((link) => link.getAttribute("href"));

const search = () =>
  screen.getByRole("searchbox", { name: "Search conversations" });

afterEach(cleanup);

describe("ThreadList search and filter", () => {
  it("shows no search or chips for an inbox of 10 threads or fewer", () => {
    renderList(INBOX.slice(0, 10));
    expect(
      screen.queryByRole("searchbox", { name: "Search conversations" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Circles" })).toBeNull();
    expect(rows()).toHaveLength(10);
  });

  it("offers a search box and the kind chips for a longer inbox, All pressed", () => {
    renderList(INBOX);
    expect(search().getAttribute("placeholder")).toBe("Search conversations…");
    for (const name of ["All", "People", "Exchanges", "Circles"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(rows()).toHaveLength(12);
  });

  it("finds a member by name, ignoring case and accents", () => {
    renderList(INBOX);
    fireEvent.change(search(), { target: { value: "ZOE" } });
    expect(rows()).toEqual(["/messages/zoe"]);
    expect(screen.getByRole("status").textContent).toBe("1 conversation");
  });

  it("finds an exchange by its puzzle or by the partner's name", () => {
    renderList(INBOX);
    fireEvent.change(search(), { target: { value: "harbour" } });
    expect(rows()).toEqual(["/messages/harbour"]);
    fireEvent.change(search(), { target: { value: "dirk" } });
    expect(rows()).toEqual(["/messages/castle"]);
  });

  it("keeps one kind with a chip, and combines it with the search", () => {
    renderList(INBOX);
    fireEvent.click(screen.getByRole("button", { name: "Circles" }));
    expect(
      screen
        .getByRole("button", { name: "Circles" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(rows()).toEqual([
      "/messages/club",
      "/messages/family",
      "/messages/wasgij",
    ]);
    fireEvent.change(search(), { target: { value: "fa" } });
    expect(rows()).toEqual(["/messages/family", "/messages/wasgij"]);
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(rows()).toEqual([]);
  });

  it("says when nothing matches, and Clear brings every thread back", () => {
    renderList(INBOX);
    fireEvent.click(screen.getByRole("button", { name: "Exchanges" }));
    fireEvent.change(search(), { target: { value: "nobody" } });
    expect(screen.getByText("No conversations match")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("0 conversations");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("No conversations match")).toBeNull();
    expect((search() as HTMLInputElement).value).toBe("");
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(rows()).toHaveLength(12);
  });

  it("reads in Dutch", () => {
    renderList(INBOX, "nl");
    expect(
      screen.getByRole("searchbox", { name: "Zoek gesprekken" }),
    ).toBeTruthy();
    for (const name of ["Alle", "Mensen", "Uitwisselingen", "Kringen"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });
});
