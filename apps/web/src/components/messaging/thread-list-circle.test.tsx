// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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

// The one-time presence prompt has its own tests (presence-sharing.test.tsx).
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

const circleThread = (
  threadId: string,
  fields: Partial<AnyInboxThread> = {},
): AnyInboxThread => ({
  threadId,
  subject: {
    kind: "circle",
    circleId: "circle_1",
    name: "Puzzle Club",
    memberCount: 6,
    memberPreview: [person("u_bas", "Bas"), person("u_anna", "Anna")],
  },
  lastMessage: {
    id: `${threadId}-m`,
    isMine: false,
    kind: "text",
    body: "Who has the Wasgij?",
    sentAt: 1,
    author: person("u_bas", "Bas"),
  },
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 1,
  ...fields,
});

const dmThread: AnyInboxThread = {
  threadId: "dm_1",
  subject: {
    kind: "dm",
    otherMember: person("u_mara", "Mara"),
    profileHandle: "mara",
  },
  lastMessage: {
    id: "dm-m",
    isMine: false,
    kind: "text",
    body: "Sounds good!",
    sentAt: 1,
  },
  unreadCount: 2,
  contextCopies: [],
  updatedAt: 1,
};

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

const row = (name: string) =>
  screen.getByText(name).closest("a") as HTMLAnchorElement;

afterEach(cleanup);

describe("ThreadList circle rows", () => {
  it("shows the circle name and prefixes the snippet with the author", () => {
    renderList([circleThread("c1")]);
    const link = row("Puzzle Club");
    expect(link.getAttribute("href")).toBe("/messages/c1");
    expect(within(link).getByText("Bas: Who has the Wasgij?")).toBeTruthy();
  });

  it.each([
    ["en", "You: Me too!"],
    ["nl", "Jij: Me too!"],
  ] as const)("prefixes the viewer's own message (%s)", (locale, expected) => {
    renderList(
      [
        circleThread("c1", {
          lastMessage: {
            id: "m",
            isMine: true,
            kind: "text",
            body: "Me too!",
            sentAt: 1,
            author: person("me", "Me"),
          },
        }),
      ],
      locale,
    );
    expect(within(row("Puzzle Club")).getByText(expected)).toBeTruthy();
  });

  it("marks a muted row and greys its count", () => {
    renderList([circleThread("c1", { muted: true, unreadCount: 3 })]);
    const link = row("Puzzle Club");
    expect(within(link).getByText("Muted")).toBeTruthy();
    const pill = within(link).getByText("3");
    expect(pill.className).toContain("bg-muted");
    expect(pill.className).not.toContain("bg-primary");
    // Muted unread doesn't call for attention: the name isn't bold.
    expect(within(link).getByText("Puzzle Club").className).not.toContain(
      "font-bold",
    );
  });

  it("keeps a DM row as it was: no prefix, primary count, no bell", () => {
    renderList([dmThread, circleThread("c1")]);
    const link = row("Mara");
    expect(within(link).getByText("Sounds good!")).toBeTruthy();
    expect(within(link).getByText("2").className).toContain("bg-primary");
    expect(within(link).queryByText("Muted")).toBeNull();
    expect(within(link).getByText("Mara").className).toContain("font-bold");
  });

  it("offers a New menu above the list", () => {
    renderList([dmThread]);
    expect(
      screen.getByRole("button", { name: "New conversation" }),
    ).toBeTruthy();
  });
});
