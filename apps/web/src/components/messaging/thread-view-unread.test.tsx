// @vitest-environment happy-dom
// UX-115: the unread boundary in a thread. The inbox's unread count, taken when
// the thread opens, places a "New messages" divider, the read receipt goes out
// only once the reader has the newest messages in view, and messages arriving
// while they read history show a "N new messages" pill.
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import en from "../../../locales/en.json";
import type { InboxThread } from "./format";
import { ThreadView } from "./thread-view";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  // The thread's messages, ascending; served newest-first as one exhausted page.
  messages: [] as unknown[],
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({
    results: [...mocks.messages].reverse(),
    status: "Exhausted",
    loadMore: () => {},
  }),
}));

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

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// happy-dom lays nothing out: give the message list (the only <ol>) a fixed
// geometry and a scrollTop the browser would clamp to [0, scrollHeight -
// clientHeight].
const geometry = { scrollHeight: 1000, clientHeight: 400 };
const scrollTops = new WeakMap<Element, number>();
const maxScrollTop = () =>
  Math.max(0, geometry.scrollHeight - geometry.clientHeight);
beforeAll(() => {
  Object.defineProperties(HTMLOListElement.prototype, {
    scrollHeight: { configurable: true, get: () => geometry.scrollHeight },
    clientHeight: { configurable: true, get: () => geometry.clientHeight },
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        scrollTops.set(this, Math.min(Math.max(0, value), maxScrollTop()));
      },
    },
  });
});
afterAll(() => {
  for (const key of ["scrollHeight", "clientHeight", "scrollTop"]) {
    Reflect.deleteProperty(HTMLOListElement.prototype, key);
  }
});

const mara = {
  _id: "member_mara",
  _creationTime: 0,
  name: "Mara",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

const dmThread = (unreadCount: number): InboxThread => ({
  threadId: "thread_1",
  subject: {
    kind: "dm",
    otherMember: { anonymous: false, member: mara },
    profileHandle: "mara",
  },
  lastMessage: null,
  unreadCount,
  contextCopies: [],
  updatedAt: 0,
});

const message = (id: string, isMine: boolean, sentAt: number) => ({
  id,
  isMine,
  kind: "text",
  body: `Message ${id}`,
  sentAt,
});

// One of mine, then two of Mara's: with unreadCount 2 both of hers are new.
const MESSAGES = [
  message("m1", true, 1_000),
  message("m2", false, 2_000),
  message("m3", false, 3_000),
];

const MARK_READ = "conversation/markThreadRead:markThreadRead";
// TanStack Query calls the mutation function a tick after mutateAsync, so let
// pending receipts land before counting them.
const receipts = async () => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return mocks.mutation.mock.calls.filter(([name]) => name === MARK_READ);
};

const renderThread = (unreadCount: number) => {
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
    convexQuery(gateway.conversation.getInboxThread, {
      threadId: "thread_1",
    }).queryKey,
    dmThread(unreadCount),
  );
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ThreadView threadId="thread_1" />
      </IntlProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { rerender: () => view.rerender(tree()) };
};

const list = () => screen.getByRole("list", { name: "Mara" });
// The reader scrolls the list to `top` (clamped like a browser would).
const scrollListTo = (top: number) => {
  list().scrollTop = top;
  fireEvent.scroll(list());
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.messages = MESSAGES;
  geometry.scrollHeight = 1000;
  geometry.clientHeight = 400;
});
afterEach(cleanup);

describe("ThreadView unread boundary", () => {
  it("puts a New messages divider before the first unread message", () => {
    renderThread(2);
    const items = Array.from(list().children).map((li) => li.textContent);
    const divider = items.indexOf("New messages");
    expect(divider).toBeGreaterThan(-1);
    // Mine stays above the divider; both of Mara's follow it.
    expect(
      items.findIndex((text) => text?.includes("Message m1")),
    ).toBeLessThan(divider);
    expect(
      items.findIndex((text) => text?.includes("Message m2")),
    ).toBeGreaterThan(divider);
  });

  it("shows no divider when nothing was unread", () => {
    renderThread(0);
    expect(screen.queryByText("New messages")).toBeNull();
  });

  it("marks the thread read on open when the newest message is in view", async () => {
    renderThread(0);
    // Opened at the bottom.
    expect(list().scrollTop).toBe(maxScrollTop());
    expect(await receipts()).toEqual([[MARK_READ, { threadId: "thread_1" }]]);
  });

  it("marks it read on open when a short unread run fits on screen", async () => {
    geometry.scrollHeight = 400;
    renderThread(2);
    expect(screen.getByText("New messages")).toBeTruthy();
    expect(await receipts()).toHaveLength(1);
  });

  it("opens at the divider and waits for the reader to reach the bottom before marking read", async () => {
    renderThread(2);
    expect(list().scrollTop).toBeLessThan(maxScrollTop());
    expect(await receipts()).toHaveLength(0);
    // Still above the newest messages: nothing is marked read.
    scrollListTo(300);
    expect(await receipts()).toHaveLength(0);
    scrollListTo(maxScrollTop());
    expect(await receipts()).toEqual([[MARK_READ, { threadId: "thread_1" }]]);
    // Scrolling around afterwards sends nothing new.
    scrollListTo(0);
    scrollListTo(maxScrollTop());
    expect(await receipts()).toHaveLength(1);
  });

  it("keeps the divider where it was when more messages arrive", () => {
    const { rerender } = renderThread(1);
    mocks.messages = [...MESSAGES, message("m4", false, 4_000)];
    rerender();
    const items = Array.from(list().children).map((li) => li.textContent);
    const divider = items.indexOf("New messages");
    // Still right before m3, the one that was unread on open.
    expect(items[divider + 1]).toContain("Message m3");
    expect(items[divider - 1]).toContain("Message m2");
  });

  it("marks an arriving message read when the reader is at the bottom", async () => {
    const { rerender } = renderThread(0);
    expect(await receipts()).toHaveLength(1);
    mocks.messages = [...MESSAGES, message("m4", false, 4_000)];
    rerender();
    expect(await receipts()).toHaveLength(2);
  });

  it("doesn't mark an arriving message read while the reader is scrolled up", async () => {
    const { rerender } = renderThread(0);
    expect(await receipts()).toHaveLength(1);
    scrollListTo(0);
    mocks.mutation.mockClear();
    mocks.messages = [...MESSAGES, message("m4", false, 4_000)];
    rerender();
    expect(await receipts()).toHaveLength(0);
    // Reaching the bottom catches up.
    scrollListTo(maxScrollTop());
    expect(await receipts()).toHaveLength(1);
  });

  it("sends no receipt for the reader's own messages", async () => {
    const { rerender } = renderThread(0);
    expect(await receipts()).toHaveLength(1);
    mocks.mutation.mockClear();
    mocks.messages = [...MESSAGES, message("m4", true, 4_000)];
    rerender();
    expect(await receipts()).toHaveLength(0);
  });
});

describe("ThreadView new-messages pill", () => {
  const pill = () => screen.queryByRole("button", { name: /new message/ });

  it("counts others' messages that arrive while the reader is scrolled up", async () => {
    const { rerender } = renderThread(0);
    scrollListTo(0);
    expect(pill()).toBeNull();
    mocks.messages = [...MESSAGES, message("m4", false, 4_000)];
    rerender();
    expect(pill()?.textContent).toBe("1 new message");
    mocks.messages = [
      ...MESSAGES,
      message("m4", false, 4_000),
      message("m5", false, 5_000),
    ];
    rerender();
    expect(pill()?.textContent).toBe("2 new messages");
  });

  it("goes away, and the thread is marked read, once the reader reaches the bottom", async () => {
    const { rerender } = renderThread(0);
    expect(await receipts()).toHaveLength(1);
    scrollListTo(0);
    mocks.messages = [...MESSAGES, message("m4", false, 4_000)];
    rerender();
    expect(pill()).toBeTruthy();
    expect(await receipts()).toHaveLength(1);
    scrollListTo(maxScrollTop());
    expect(pill()).toBeNull();
    expect(await receipts()).toHaveLength(2);
  });

  it("scrolls to the newest message when pressed, keeping focus in the list", async () => {
    const { rerender } = renderThread(0);
    scrollListTo(0);
    mocks.messages = [...MESSAGES, message("m4", false, 4_000)];
    rerender();
    fireEvent.click(screen.getByRole("button", { name: "1 new message" }));
    expect(document.activeElement).toBe(list());
    await waitFor(() => expect(list().scrollTop).toBe(maxScrollTop()));
    fireEvent.scroll(list());
    expect(pill()).toBeNull();
  });

  it("shows nothing for the reader's own send while scrolled up", () => {
    const { rerender } = renderThread(0);
    scrollListTo(0);
    mocks.messages = [...MESSAGES, message("pending-1", true, 4_000)];
    rerender();
    expect(pill()).toBeNull();
    // Confirmed: the pending id gives way to the real one.
    mocks.messages = [...MESSAGES, message("m4", true, 4_000)];
    rerender();
    expect(pill()).toBeNull();
  });

  it("doesn't count the unread messages below the divider on open", () => {
    renderThread(2);
    // The open scrolled the list to the divider.
    fireEvent.scroll(list());
    expect(screen.getByText("New messages")).toBeTruthy();
    expect(pill()).toBeNull();
  });
});
