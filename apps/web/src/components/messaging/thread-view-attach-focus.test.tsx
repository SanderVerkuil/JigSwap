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

// Where focus lands when a thread opens: its title (keyboard and screen-reader users land in the
// conversation), unless a copy's "Message" opened it to write about that puzzle.

const mocks = vi.hoisted(() => ({ isMobile: false }));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: () => {},
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));
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

const row = (threadId: string, name: string): InboxThread => ({
  threadId,
  subject: {
    kind: "dm",
    otherMember: {
      anonymous: false,
      member: {
        _id: `member_${name}`,
        _creationTime: 0,
        name,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      },
    },
    profileHandle: name,
  },
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
});

const CARD = {
  copyId: "copy_1",
  title: "Harbour Lights",
  brand: null,
  pieceCount: 1000,
  coverUrl: null,
};

function setup(attachCopyId?: string) {
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
  for (const thread of [row("thread_1", "Mara"), row("thread_2", "Noor")]) {
    queryClient.setQueryData(
      convexQuery(gateway.conversation.getInboxThread, {
        threadId: thread.threadId as Id<"threads">,
      }).queryKey,
      thread,
    );
  }
  queryClient.setQueryData(
    convexQuery(gateway.conversation.getCopyConversation, {
      copyId: "copy_1" as Id<"ownedPuzzles">,
    }).queryKey,
    { status: "existing", threadId: "thread_1", copy: CARD },
  );
  const tree = (threadId: string) => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ThreadView threadId={threadId} attachCopyId={attachCopyId} />
      </IntlProvider>
    </QueryClientProvider>
  );
  const view = render(tree("thread_1"));
  return { open: (threadId: string) => view.rerender(tree(threadId)) };
}

const heading = (name: string) =>
  screen.getByRole("heading", { level: 2, name });
const composer = (name: string) =>
  screen.getByRole("textbox", { name: `Message ${name}` });

afterEach(() => {
  cleanup();
  mocks.isMobile = false;
});

describe("ThreadView focus", () => {
  it("lands on the thread's title in the ordinary case", async () => {
    const { open } = setup();
    await act(async () => {});
    expect(document.activeElement).toBe(heading("Mara"));
    open("thread_2");
    await act(async () => {});
    expect(document.activeElement).toBe(heading("Noor"));
  });

  it("lands in the composer when a copy's Message opened it, then goes back to the title rule", async () => {
    const { open } = setup("copy_1");
    await act(async () => {});
    expect(document.activeElement).toBe(composer("Mara"));

    open("thread_2");
    await act(async () => {});
    expect(document.activeElement).toBe(heading("Noor"));

    open("thread_1");
    await act(async () => {});
    expect(document.activeElement).toBe(heading("Mara"));
  });

  it("stays on the title on a phone, so the keyboard stays down", async () => {
    mocks.isMobile = true;
    setup("copy_1");
    await act(async () => {});
    expect(document.activeElement).toBe(heading("Mara"));
  });
});
