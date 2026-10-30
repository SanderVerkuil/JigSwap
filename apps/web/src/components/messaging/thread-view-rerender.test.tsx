// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import type { InboxThread } from "./format";
import { ThreadView } from "./thread-view";

const mocks = vi.hoisted(() => ({
  // Newest first, one exhausted page; a stable array, as Convex returns while nothing changes.
  newestFirst: [
    { id: "m2", isMine: false, kind: "text", body: "Second", sentAt: 2 },
    { id: "m1", isMine: true, kind: "text", body: "First", sentAt: 1 },
  ] as unknown[],
  textRenders: 0,
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({
    results: mocks.newestFirst,
    status: "Exhausted",
    loadMore: () => {},
  }),
}));

// Counts bubble renders.
vi.mock("./message-text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-text")>();
  return {
    ...actual,
    MessageText: (props: { body: string }) => {
      mocks.textRenders++;
      return <actual.MessageText {...props} />;
    },
  };
});

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => {
    const fn = () => Promise.resolve(null);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

const thread: InboxThread = {
  threadId: "thread_1",
  subject: {
    kind: "dm",
    otherMember: {
      anonymous: false,
      member: {
        _id: "member_mara",
        _creationTime: 0,
        name: "Mara",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      },
    },
    profileHandle: "mara",
  },
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
};

afterEach(cleanup);

function renderThread() {
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
  const rowKey = convexQuery(gateway.conversation.getInboxThread, {
    threadId: thread.threadId as Id<"threads">,
  }).queryKey;
  queryClient.setQueryData(rowKey, thread);
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ThreadView threadId={thread.threadId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { queryClient, rowKey };
}

describe("ThreadView re-renders", () => {
  it("doesn't re-render the bubbles when only the inbox row changes", async () => {
    const { queryClient, rowKey } = renderThread();
    expect(screen.getByText("Second")).toBeTruthy();
    const before = mocks.textRenders;
    expect(before).toBeGreaterThan(0);

    // The inbox subscription updates the thread's row without touching its messages.
    await act(async () => {
      queryClient.setQueryData(rowKey, {
        ...thread,
        unreadCount: 3,
        updatedAt: 9,
      });
      // TanStack Query batches observer notifications onto a later tick.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.textRenders).toBe(before);
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("skips the bubbles on minute ticks, and still rolls Today over to Yesterday at midnight", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 30, 23, 57));
      const sentAt = new Date(2026, 9, 30, 23, 56).getTime();
      mocks.newestFirst = [
        { id: "m1", isMine: false, kind: "text", body: "Late", sentAt },
      ];
      renderThread();
      expect(screen.getByText("Today")).toBeTruthy();
      const before = mocks.textRenders;

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(mocks.textRenders).toBe(before);
      expect(screen.getByText("Today")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(2 * 60_000);
      });
      expect(screen.getByText("Yesterday")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
