// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { COMPOSER_SLOT_CLASS } from "./composer-closed";
import type { InboxThread } from "./format";
import { ThreadView } from "./thread-view";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  // The thread's messages, ascending; served newest-first as one exhausted page.
  messages: [] as unknown[],
}));

// ThreadView pages listThreadMessages through Convex's usePaginatedQuery (#174).
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

// Both the plain mutation function and the optimistic-update chain the composer uses.
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const POST = getFunctionName(gateway.conversation.postMessage);
const UNBLOCK = getFunctionName(gateway.social.unblockMember);

const mara = {
  _id: "member_mara",
  _creationTime: 0,
  name: "Mara",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

type ThreadState = { blocked: "byMe" } | { readOnly: true };

const threadOf = (
  subject: InboxThread["subject"],
  state?: ThreadState,
): InboxThread => ({
  threadId: "thread_1",
  subject,
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
  ...state,
});

const dmThread = (state?: ThreadState) =>
  threadOf(
    {
      kind: "dm",
      otherMember: { anonymous: false, member: mara },
      profileHandle: "mara",
    },
    state,
  );

const exchangeThread = (state?: ThreadState) =>
  threadOf(
    {
      kind: "exchange",
      exchangeId: "exchange_1",
      exchangeType: "trade",
      puzzleTitle: "Night Harbour",
      otherMember: { anonymous: false, member: mara },
      profileHandle: "mara",
    },
    state,
  );

// The header's one overflow menu, opened; resolves to its items' names.
const openThreadMenu = async () => {
  const triggers = screen.getAllByRole("button", {
    name: "Conversation options",
  });
  expect(triggers).toHaveLength(1);
  fireEvent.keyDown(triggers[0]!, { key: "Enter" });
  const items = await screen.findAllByRole("menuitem");
  return items.map((item) => item.textContent);
};

const renderThread = (thread: InboxThread) => {
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
  // #160: messages carry viewer-relative `isMine`, never a raw author id.
  mocks.messages = [
    {
      id: "m1",
      isMine: false,
      kind: "text",
      body: "Earlier message",
      sentAt: 0,
    },
  ];
  queryClient.setQueryData(
    convexQuery(gateway.conversation.getMyInbox, {}).queryKey,
    [thread],
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ThreadView threadId={thread.threadId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("ThreadView composer slot when blocked", () => {
  it("byMe: replaces the composer with the blocked banner and Unblock", async () => {
    renderThread(dmThread({ blocked: "byMe" }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("You blocked Mara.");
    expect(screen.queryByRole("textbox")).toBeNull();
    // History stays readable.
    expect(screen.getByText("Earlier message")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    expect(
      screen.getByRole("alertdialog", { name: "Unblock Mara?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Unblock" }).at(-1)!);
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UNBLOCK, {
        memberId: "member_mara",
      }),
    );
  });

  it("frames the banner like the composer slot (padding, border, safe-area inset)", () => {
    renderThread(dmThread());
    const composerSlot = screen
      .getByRole("textbox")
      .closest(".border-t") as HTMLElement;
    expect(composerSlot.className).toBe(COMPOSER_SLOT_CLASS);
    cleanup();

    renderThread(dmThread({ blocked: "byMe" }));
    expect(screen.getByRole("status").parentElement?.className).toBe(
      COMPOSER_SLOT_CLASS,
    );
  });

  it("readOnly: shows the neutral can't-reply text and never mentions a block", () => {
    renderThread(dmThread({ readOnly: true }));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("You can't reply to this conversation.");
    expect(status.textContent).not.toMatch(/block/i);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Earlier message")).toBeTruthy();
  });

  it.each(["CannotReply", "NotConnected"])(
    "closes the composer with the neutral text when a send fails with %s",
    async (code) => {
      mocks.mutation.mockImplementation(async (name) => {
        if (name === POST) throw new ConvexError({ code });
        return null;
      });
      renderThread(dmThread());
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Hello?" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe(
          "You can't reply to this conversation.",
        ),
      );
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("offers Report and Block {name} in the header's one overflow menu, after the quick links", async () => {
    renderThread(dmThread());
    expect(await openThreadMenu()).toEqual([
      "View profile",
      "Report Mara",
      "Block Mara",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Block Mara" }));
    expect(
      await screen.findByRole("alertdialog", { name: "Block Mara?" }),
    ).toBeTruthy();
  });

  it("byMe: the overflow menu keeps the quick links but offers no Block", async () => {
    renderThread(dmThread({ blocked: "byMe" }));
    expect(await openThreadMenu()).toEqual(["View profile"]);
  });

  it("offers Report and Block {name} for an exchange thread's partner", async () => {
    renderThread(exchangeThread());
    expect(await openThreadMenu()).toEqual([
      "View profile",
      "View exchange",
      "Report Mara",
      "Block Mara",
    ]);
  });

  it("byMe on an exchange thread names the partner in the banner", () => {
    renderThread(exchangeThread({ blocked: "byMe" }));
    expect(screen.getByRole("status").textContent).toContain(
      "You blocked Mara.",
    );
    expect(screen.getByRole("button", { name: "Unblock" })).toBeTruthy();
  });

  it("byMe with an anonymised partner falls back to the unnamed banner", () => {
    renderThread(
      threadOf(
        {
          kind: "dm",
          otherMember: { anonymous: true, anonRef: "anon_1" },
          profileHandle: null,
        },
        { blocked: "byMe" },
      ),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "You blocked this member. You can unblock them under Privacy & safety.",
    );
    expect(
      screen.queryByRole("button", { name: "Conversation options" }),
    ).toBeNull();
  });
});
