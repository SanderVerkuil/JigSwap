// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import type { AnyInboxThread } from "./format";
import { InboxWindowProvider } from "./inbox-window";
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

// `count` DM threads, newest first: "Member 1" is the most recent.
const threads = (count: number): AnyInboxThread[] =>
  Array.from({ length: count }, (_, i) => ({
    threadId: `dm_${i + 1}`,
    subject: {
      kind: "dm",
      otherMember: {
        anonymous: false,
        member: {
          _id: `member_${i + 1}`,
          _creationTime: 0,
          name: `Member ${i + 1}`,
          isActive: true,
          createdAt: 0,
          updatedAt: 0,
        },
      },
      profileHandle: `member-${i + 1}`,
    },
    lastMessage: {
      id: `m_${i + 1}`,
      isMine: false,
      kind: "text",
      body: "Hello",
      sentAt: 1_000 - i,
    },
    unreadCount: 0,
    contextCopies: [],
    updatedAt: 1_000 - i,
  }));

// The inbox's windows as getMyInbox answers them: `pages` maps a requested
// limit (30 = the default, asked with no args) to the rows it returns. A
// window left out stays loading.
const setup = (
  pages: Record<number, AnyInboxThread[]>,
  locale: "en" | "nl" = "en",
) => {
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
  for (const [limit, rows] of Object.entries(pages)) {
    queryClient.setQueryData(
      convexQuery(
        gateway.conversation.getMyInbox,
        Number(limit) === 30 ? {} : { limit: Number(limit) },
      ).queryKey,
      rows,
    );
  }
  const tree = (listKey: string) => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <InboxWindowProvider>
          <ThreadList key={listKey} />
        </InboxWindowProvider>
      </IntlProvider>
    </QueryClientProvider>
  );
  const view = render(tree("first"));
  // Mount a fresh ThreadList under the same layout, as moving between the
  // inbox and a thread does.
  return { remountList: () => view.rerender(tree("second")) };
};

const rowLinks = () =>
  screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/messages/"));

const showOlder = () =>
  screen.queryByRole("button", { name: "Show older conversations" });

afterEach(cleanup);

describe("ThreadList paging", () => {
  it("offers older conversations under a full page and shows the next window", () => {
    setup({ 30: threads(30), 60: threads(45) });
    expect(rowLinks()).toHaveLength(30);

    fireEvent.click(showOlder()!);
    expect(rowLinks()).toHaveLength(45);
    // Fewer than asked for: that was all of them.
    expect(showOlder()).toBeNull();
    // Focus lands on the first row the window added.
    expect(document.activeElement).toBe(rowLinks()[30]);
  });

  it("offers nothing when the inbox fits one page", () => {
    setup({ 30: threads(12) });
    expect(rowLinks()).toHaveLength(12);
    expect(showOlder()).toBeNull();
  });

  it("keeps the rows and the button while the next window loads", () => {
    setup({ 30: threads(30) });
    fireEvent.click(showOlder()!);

    expect(rowLinks()).toHaveLength(30);
    const loading = screen.getByRole("button", {
      name: "Loading older conversations…",
    });
    expect(loading.getAttribute("aria-disabled")).toBe("true");
  });

  it("grows by 30 up to the backend's cap of 100", () => {
    setup({
      30: threads(30),
      60: threads(60),
      90: threads(90),
      100: threads(100),
    });
    fireEvent.click(showOlder()!);
    fireEvent.click(showOlder()!);
    fireEvent.click(showOlder()!);
    expect(rowLinks()).toHaveLength(100);
    expect(showOlder()).toBeNull();
  });

  it("keeps the window when the list mounts again under the messages layout", () => {
    const { remountList } = setup({ 30: threads(30), 60: threads(60) });
    fireEvent.click(showOlder()!);
    expect(rowLinks()).toHaveLength(60);

    remountList();
    expect(rowLinks()).toHaveLength(60);
  });

  it("speaks Dutch", () => {
    setup({ 30: threads(30) }, "nl");
    expect(
      screen.getByRole("button", { name: "Oudere gesprekken tonen" }),
    ).toBeTruthy();
  });
});
