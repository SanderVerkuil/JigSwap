// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
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

const MESSAGES = [
  { id: "m1", authorId: "me", kind: "text", body: "My own message", sentAt: 1 },
  {
    id: "m2",
    authorId: "member_mara",
    kind: "text",
    body: "Mara's message",
    sentAt: 2,
  },
  {
    id: "m3",
    authorId: null,
    kind: "system",
    body: "Trade accepted",
    sentAt: 3,
  },
  {
    id: "m4",
    authorId: "member_mara",
    kind: "text",
    body: "",
    sentAt: 4,
    removed: true,
  },
];

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
    MESSAGES,
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

describe("ThreadView message actions", () => {
  it("offers More only on the other member's non-system, non-removed messages", () => {
    renderThread(dmThread());
    expect(
      screen.getAllByRole("button", {
        name: "More actions for message from Mara",
      }),
    ).toHaveLength(1);
  });

  it("renders a removed message as the moderator placeholder, never its body", () => {
    renderThread(dmThread());
    expect(
      screen.getByText("This message was removed by a moderator."),
    ).toBeTruthy();
    expect(screen.getByText("Mara's message")).toBeTruthy();
  });

  it("opens the report dialog with the quoted message from the menu", async () => {
    renderThread(dmThread());
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "More actions for message from Mara",
      }),
      { key: "Enter" },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Copy text" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message" }));
    const dialog = await screen.findByRole("dialog", { name: "Report Mara" });
    expect(dialog.querySelector("blockquote")?.textContent).toBe(
      "Mara's message",
    );
    expect(
      screen.getByRole("checkbox", { name: "Also block Mara" }),
    ).toBeTruthy();
  });

  it("offers Report {name} before Block in the header menu", async () => {
    renderThread(dmThread());
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Conversation options" }),
      { key: "Enter" },
    );
    await screen.findByRole("menuitem", { name: "Block Mara" });
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["View profile", "Report Mara", "Block Mara"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report Mara" }));
    expect(await screen.findByText("Reporting Mara")).toBeTruthy();
  });
});
