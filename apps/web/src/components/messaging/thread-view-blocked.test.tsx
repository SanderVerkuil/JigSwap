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
import type { InboxThread } from "./format";
import { ThreadView } from "./thread-view";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
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

const dmThread = (blocked?: "byMe" | "byThem"): InboxThread => ({
  threadId: "thread_1",
  subject: {
    kind: "dm",
    otherMember: { anonymous: false, member: mara },
    profileHandle: "mara",
  },
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
  ...(blocked ? { blocked } : {}),
});

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
  queryClient.setQueryData(
    convexQuery(gateway.conversation.getThreadMessages, {
      threadId: thread.threadId,
    }).queryKey,
    [
      {
        id: "m1",
        authorId: "member_mara",
        kind: "text",
        body: "Earlier message",
        sentAt: 0,
      },
    ],
  );
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
    renderThread(dmThread("byMe"));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("You blocked Mara.");
    expect(screen.queryByRole("textbox")).toBeNull();
    // History stays readable.
    expect(screen.getByText("Earlier message")).toBeTruthy();
    // Already blocked: the header offers no Block.
    expect(
      screen.queryByRole("button", { name: "Conversation actions" }),
    ).toBeNull();

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

  it("byThem: shows the neutral can't-reply text and never mentions a block", () => {
    renderThread(dmThread("byThem"));
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("You can't reply to this conversation.");
    expect(status.textContent).not.toMatch(/block/i);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Earlier message")).toBeTruthy();
  });

  it("closes the composer with the neutral text when a send fails with NotConnected", async () => {
    mocks.mutation.mockImplementation(async (name) => {
      if (name === POST) throw new ConvexError({ code: "NotConnected" });
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
  });

  it("offers Block {name} in the header menu of an open thread", async () => {
    renderThread(dmThread());
    const trigger = screen.getByRole("button", {
      name: "Conversation actions",
    });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const item = await screen.findByRole("menuitem", { name: "Block Mara" });
    fireEvent.click(item);
    expect(
      await screen.findByRole("alertdialog", { name: "Block Mara?" }),
    ).toBeTruthy();
  });
});
