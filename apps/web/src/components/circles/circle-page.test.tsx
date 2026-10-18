// @vitest-environment happy-dom
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
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CHAT_PREVIEW_SIZE, CirclePage } from "./circle-page";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  navigate: vi.fn(),
}));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Detail = NonNullable<FunctionReturnType<typeof gateway.sharing.circle>>;
type Messages = FunctionReturnType<
  typeof gateway.conversation.getThreadMessages
>;
type Copies = FunctionReturnType<typeof gateway.sharing.circleSharedCopies>;

const CIRCLE = "circle_1";
const THREAD = "thread_1";

const seat = (id: string, name: string, extra: object = {}) => ({
  membershipId: `m_${id}`,
  memberId: id,
  name,
  permission: "ViewOnly" as const,
  joinedAt: 0,
  isOwner: false,
  ...extra,
});

const detail = (fields: Partial<Detail> = {}): Detail => ({
  _id: "row_1",
  aggregateId: CIRCLE,
  ownerId: "u_anna",
  name: "Puzzle Club",
  memberCount: 3,
  isOwnedByViewer: false,
  viewerPermission: "ViewOnly",
  createdAt: 0,
  members: [
    seat("u_anna", "Anna", { isOwner: true, permission: "Admin" }),
    seat("u_bas", "Bas"),
    seat("me", "Me"),
  ],
  ...fields,
});

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

const text = (id: string, body: string, fields: object = {}) => ({
  id,
  isMine: false,
  kind: "text" as const,
  body,
  sentAt: Date.UTC(2026, 9, 18, 12),
  author: person("u_bas", "Bas"),
  ...fields,
});

const renderPage = ({
  circle,
  threadId = THREAD,
  messages = [],
  copies = [],
  locale = "en",
}: {
  circle: Detail | null;
  threadId?: string | null;
  messages?: Messages;
  copies?: Copies;
  locale?: "en" | "nl";
}) => {
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
  const set = (key: readonly unknown[], data: unknown) =>
    queryClient.setQueryData(key, data);
  set(
    convexQuery(gateway.sharing.circle, { circleId: CIRCLE }).queryKey,
    circle,
  );
  set(
    convexQuery(gateway.conversation.getCircleThreadId, { circleId: CIRCLE })
      .queryKey,
    threadId,
  );
  if (threadId) {
    set(
      convexQuery(gateway.conversation.getThreadMessages, {
        threadId,
        limit: CHAT_PREVIEW_SIZE,
      }).queryKey,
      messages,
    );
  }
  set(
    convexQuery(gateway.sharing.circleSharedCopies, { circleId: CIRCLE })
      .queryKey,
    copies,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <CirclePage circleId={CIRCLE} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.navigate.mockReset();
});
afterEach(cleanup);

describe("CirclePage", () => {
  it("shows a member the circle's name, members and the leave action", () => {
    renderPage({ circle: detail() });
    expect(
      screen.getByRole("heading", { name: "Puzzle Club", level: 2 }),
    ).toBeTruthy();
    expect(screen.getByText("3 members")).toBeTruthy();
    const stack = screen.getByRole("group", { name: "Members of Puzzle Club" });
    expect(within(stack).getByRole("button", { name: "Bas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leave circle" })).toBeTruthy();
    // Managing is Admin-only.
    expect(
      screen.queryByRole("button", { name: "Manage Puzzle Club" }),
    ).toBeNull();
  });

  it("offers an Admin owner the manage action and no leave", () => {
    renderPage({
      circle: detail({
        isOwnedByViewer: true,
        viewerPermission: "Admin",
        ownerId: "me",
      }),
    });
    expect(
      screen.getByRole("button", { name: "Manage Puzzle Club" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave circle" })).toBeNull();
  });

  it("renders the generic not-found page for a non-member or an unknown circle", () => {
    renderPage({ circle: null, threadId: null });
    expect(screen.getByText(en.notFound.title)).toBeTruthy();
    expect(screen.queryByText("Puzzle Club")).toBeNull();
    expect(screen.queryByText(en.circles.page.chatTitle)).toBeNull();
  });

  it("shows an empty chat state when the circle has no thread, and doesn't open one", () => {
    renderPage({ circle: detail(), threadId: null });
    expect(screen.getByText(en.circles.page.chatEmpty)).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("opens the group chat only when the button is pressed", async () => {
    mocks.mutation.mockResolvedValue(THREAD);
    renderPage({ circle: detail(), threadId: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Open group chat: Puzzle Club" }),
    );
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/messages/$threadId",
        params: { threadId: THREAD },
      }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(
      "conversation/openCircleThread:openCircleThread",
      { circleId: CIRCLE },
    );
  });

  it("previews the latest messages with their authors and system rows", () => {
    renderPage({
      circle: detail(),
      messages: [
        {
          id: "s1",
          isMine: false,
          kind: "system",
          body: "",
          sentAt: 1,
          systemEvent: { kind: "joined", member: person("me", "Me") },
        },
        text("m1", "Who has the Wasgij?"),
        text("m2", "Me too!", { isMine: true, author: person("me", "Me") }),
      ],
    });
    expect(screen.getByText("You joined")).toBeTruthy();
    expect(screen.getByText("Bas: Who has the Wasgij?")).toBeTruthy();
    expect(screen.getByText("You: Me too!")).toBeTruthy();
    expect(screen.queryByText(en.circles.page.chatEmpty)).toBeNull();
  });

  it("collapses a blocked member's message to the placeholder, never its text", () => {
    renderPage({
      circle: detail(),
      messages: [text("m1", "secret words", { authorBlockedByMe: true })],
    });
    expect(screen.getByText("Message from a member you blocked")).toBeTruthy();
    expect(screen.queryByText(/secret words/)).toBeNull();
    // No Show here: the full chat is where a blocked message can be revealed.
    expect(screen.queryByRole("button", { name: "Show" })).toBeNull();
  });

  it("lists the shared puzzles, each linking to its copy page", () => {
    renderPage({
      circle: detail(),
      copies: [
        {
          copyId: "copy_1",
          title: "Lighthouse",
          brand: "Ravensburger",
          pieceCount: 1000,
          coverUrl: null,
        },
      ],
    });
    const link = screen.getByText("Lighthouse").closest("a");
    expect(link?.getAttribute("href")).toBe("/copies/copy_1");
    expect(screen.queryByText(en.circles.page.sharedEmpty)).toBeNull();
  });

  it("says so when nothing is shared yet (nl)", () => {
    renderPage({ circle: detail(), locale: "nl" });
    expect(screen.getByText(nl.circles.page.sharedEmpty)).toBeTruthy();
    expect(screen.getByText("3 leden")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Groepschat openen: Puzzle Club" }),
    ).toBeTruthy();
  });
});
