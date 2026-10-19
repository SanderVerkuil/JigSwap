// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import type { AnyInboxThread } from "./format";
import { ThreadView } from "./thread-view";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
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

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
const anna = person("u_anna", "Anna");
const bas = person("u_bas", "Bas");

const minute = (n: number) => new Date(2026, 9, 18, 13, n).getTime();

const CIRCLE_MESSAGES = [
  {
    id: "s1",
    isMine: false,
    kind: "system",
    body: "",
    sentAt: minute(0),
    systemEvent: { kind: "joined", member: person("me", "Me") },
  },
  {
    id: "s2",
    isMine: false,
    kind: "system",
    body: "",
    sentAt: minute(1),
    systemEvent: { kind: "joined", member: anna },
  },
  {
    id: "s3",
    isMine: false,
    kind: "system",
    body: "",
    sentAt: minute(2),
    systemEvent: { kind: "left" },
  },
  {
    id: "a1",
    isMine: false,
    kind: "text",
    body: "Who has the Wasgij?",
    sentAt: minute(3),
    author: anna,
  },
  {
    id: "a2",
    isMine: false,
    kind: "text",
    body: "I can lend it",
    sentAt: minute(4),
    author: anna,
  },
  {
    id: "b1",
    isMine: false,
    kind: "text",
    body: "A hidden remark",
    sentAt: minute(5),
    author: bas,
    authorBlockedByMe: true,
  },
  {
    id: "b2",
    isMine: false,
    kind: "image",
    body: "",
    sentAt: minute(6),
    author: bas,
    authorBlockedByMe: true,
    attachmentId: "att_1",
    attachment: {
      status: "visible",
      url: "https://example.com/photo.jpg",
      width: 10,
      height: 10,
    },
  },
  {
    id: "me1",
    isMine: true,
    kind: "text",
    body: "Me too!",
    sentAt: minute(7),
    author: person("me", "Me"),
  },
];

const SHARED_COPY = {
  copyId: "copy_1",
  title: "Harbour Lights",
  brand: "Ravensburger",
  pieceCount: 1000,
  coverUrl: null,
};

const circleThread: AnyInboxThread = {
  threadId: "thread_c",
  subject: {
    kind: "circle",
    circleId: "circle_1",
    name: "Puzzle Club",
    memberCount: 6,
    memberPreview: [bas, anna],
  },
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
};

const CIRCLE_DETAIL = {
  _id: "circle_doc",
  aggregateId: "circle_1",
  name: "Puzzle Club",
  memberCount: 3,
  isOwnedByViewer: false,
  viewerPermission: "Exchange",
  createdAt: 0,
  members: [
    {
      membershipId: "ms1",
      memberId: "u_anna",
      name: "Anna",
      permission: "Admin",
      joinedAt: 0,
      isOwner: true,
    },
    {
      membershipId: "ms2",
      memberId: "me",
      name: "Me",
      permission: "Exchange",
      joinedAt: 0,
      isOwner: false,
    },
    {
      membershipId: "ms3",
      // A departed seat carries no memberId (getCircle drops it).
      departed: true,
      permission: "Exchange",
      joinedAt: 0,
      isOwner: false,
    },
  ],
};

const renderThread = (
  thread: AnyInboxThread,
  messages: unknown[],
  locale: "en" | "nl" = "en",
  presence?: { memberId: string; status: "online" | "away" }[],
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
  mocks.messages = messages;
  queryClient.setQueryData(
    convexQuery(gateway.conversation.getMyInbox, {}).queryKey,
    [thread],
  );
  queryClient.setQueryData(
    convexQuery(gateway.sharing.circle, { circleId: "circle_1" }).queryKey,
    CIRCLE_DETAIL,
  );
  queryClient.setQueryData(
    convexQuery(gateway.conversation.listAttachableCopies, {
      threadId: thread.threadId,
      side: "mine",
    }).queryKey,
    [SHARED_COPY],
  );
  if (presence) {
    // The viewer shares; one batched read for the members other than "me".
    queryClient.setQueryData(
      convexQuery(gateway.social.presenceSettings, {}).queryKey,
      { share: true, override: "auto" },
    );
    queryClient.setQueryData(
      convexQuery(gateway.social.presenceOf, {
        memberIds: ["u_anna" as Id<"users">],
      }).queryKey,
      presence,
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ThreadView threadId={thread.threadId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("ThreadView in a circle thread", () => {
  it("heads the thread with the circle name and its member count", () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    expect(screen.getByRole("heading", { name: "Puzzle Club" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "6 members" })).toBeTruthy();
  });

  it("says the member count in Dutch", () => {
    renderThread(circleThread, CIRCLE_MESSAGES, "nl");
    expect(screen.getByRole("button", { name: "6 leden" })).toBeTruthy();
  });

  it("renders join and leave rows: own, named and anonymous", () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    expect(screen.getByText("You joined")).toBeTruthy();
    expect(screen.getByText("Anna joined")).toBeTruthy();
    expect(screen.getByText("A member left")).toBeTruthy();
  });

  it("renders the system rows in Dutch", () => {
    renderThread(circleThread, CIRCLE_MESSAGES, "nl");
    expect(screen.getByText("Je doet nu mee")).toBeTruthy();
    expect(screen.getByText("Anna doet nu mee")).toBeTruthy();
    expect(screen.getByText("Een lid zit niet meer in de kring")).toBeTruthy();
  });

  it("names the author once above each run, linking their profile", () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    const annaLinks = screen.getAllByRole("link", { name: "Anna" });
    expect(annaLinks).toHaveLength(1);
    expect(annaLinks[0].getAttribute("href")).toBe("/members/u_anna");
    expect(screen.getByText("Who has the Wasgij?")).toBeTruthy();
    expect(screen.getByText("I can lend it")).toBeTruthy();
  });

  it("collapses a blocked member's run until Show; photos stay collapsed", () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    expect(screen.queryByText("A hidden remark")).toBeNull();
    expect(
      screen.getByText("2 messages from a member you blocked"),
    ).toBeTruthy();
    expect(document.querySelector('img[src*="photo.jpg"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));

    expect(screen.getByText("A hidden remark")).toBeTruthy();
    expect(screen.getByText("Photo from a member you blocked")).toBeTruthy();
    expect(document.querySelector('img[src*="photo.jpg"]')).toBeNull();
  });

  it("opens the members panel from the member count", async () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    fireEvent.click(screen.getByRole("button", { name: "6 members" }));
    const panel = await screen.findByRole("dialog", { name: "Members (3)" });
    expect(within(panel).getByText("Owner")).toBeTruthy();
    expect(within(panel).getByText("(You)")).toBeTruthy();
    expect(within(panel).getByText("Deleted member")).toBeTruthy();
    // Report for other members only: not for the viewer or a departed seat.
    expect(
      within(panel).getAllByRole("button", { name: /^Report / }),
    ).toHaveLength(1);
    expect(
      within(panel).getByRole("button", { name: "Mute conversation" }),
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: "Leave circle" }),
    ).toBeTruthy();
  });

  it("mutes the conversation from the members panel", async () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    fireEvent.click(screen.getByRole("button", { name: "6 members" }));
    const panel = await screen.findByRole("dialog", { name: "Members (3)" });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Mute conversation" }),
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        "conversation/setThreadMuted:setThreadMuted",
        { threadId: "thread_c", muted: true },
      ),
    );
  });

  it("addresses the composer to the circle", () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    expect(screen.getByPlaceholderText("Write to Puzzle Club…")).toBeTruthy();
  });

  it("offers a puzzle to attach: only my puzzles, with who can see them", async () => {
    renderThread(circleThread, CIRCLE_MESSAGES);
    fireEvent.keyDown(screen.getByRole("button", { name: "Attach" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Attach a puzzle" }),
    );
    const picker = await screen.findByRole("dialog", {
      name: "Attach a puzzle",
    });
    expect(
      within(picker)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["My puzzles"]);
    expect(
      within(picker).getByText(
        "Only your puzzles that everyone in Puzzle Club can see. Share a puzzle with the circle to add it here.",
      ),
    ).toBeTruthy();
    expect(within(picker).getByText("Harbour Lights")).toBeTruthy();
  });

  it("shows a shared puzzle's card, or that it is no longer available", () => {
    renderThread(circleThread, [
      ...CIRCLE_MESSAGES,
      {
        id: "c1",
        isMine: false,
        kind: "text",
        body: "Anyone want this?",
        sentAt: minute(8),
        author: anna,
        copy: SHARED_COPY,
      },
      {
        id: "c2",
        isMine: false,
        kind: "text",
        body: "And this one",
        sentAt: minute(9),
        author: anna,
        copyUnavailable: true,
      },
    ]);
    expect(screen.getByText("Harbour Lights")).toBeTruthy();
    expect(screen.getByText("This puzzle is no longer available")).toBeTruthy();
  });

  it("says the puzzle is no longer available in Dutch", () => {
    renderThread(
      circleThread,
      [
        {
          id: "c2",
          isMine: false,
          kind: "text",
          body: "En deze",
          sentAt: minute(9),
          author: anna,
          copyUnavailable: true,
        },
      ],
      "nl",
    );
    expect(
      screen.getByText(nl.messages.copyUnavailable as string),
    ).toBeTruthy();
  });
});

describe("ThreadView circle presence", () => {
  it("adds '· N online' and the member's dot in the panel", async () => {
    renderThread(circleThread, CIRCLE_MESSAGES, "en", [
      { memberId: "u_anna", status: "online" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "6 members · 1 online" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Members (3)" });
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map(
          (row) =>
            row
              .querySelector("[data-presence]")
              ?.getAttribute("data-presence") ?? null,
        ),
    ).toEqual(["online", null, null]);
  });

  it("says it in Dutch", () => {
    renderThread(circleThread, CIRCLE_MESSAGES, "nl", [
      { memberId: "u_anna", status: "online" },
    ]);
    expect(
      screen.getByRole("button", { name: "6 leden · 1 online" }),
    ).toBeTruthy();
  });

  it("counts only Online, so an Away member shows a dot but no count", async () => {
    renderThread(circleThread, CIRCLE_MESSAGES, "en", [
      { memberId: "u_anna", status: "away" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "6 members" }));
    const panel = await screen.findByRole("dialog", { name: "Members (3)" });
    expect(within(panel).getByText("Away")).toBeTruthy();
  });

  it("shows just the member count when nobody is visible", () => {
    renderThread(circleThread, CIRCLE_MESSAGES, "en", []);
    expect(screen.getByRole("button", { name: "6 members" })).toBeTruthy();
  });
});

describe("ThreadView in a DM stays as it was", () => {
  const mara = person("u_mara", "Mara");
  const dmThread: AnyInboxThread = {
    threadId: "thread_dm",
    subject: { kind: "dm", otherMember: mara, profileHandle: "mara" },
    lastMessage: null,
    unreadCount: 0,
    contextCopies: [],
    updatedAt: 0,
  };
  const DM_MESSAGES = [
    { id: "m1", isMine: false, kind: "text", body: "Hi", sentAt: minute(0) },
    { id: "m2", isMine: false, kind: "text", body: "There", sentAt: minute(1) },
  ];

  it("has no member line, no author header and the usual placeholder", () => {
    renderThread(dmThread, DM_MESSAGES);
    expect(screen.queryByRole("button", { name: /members/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Mara" })).toBeNull();
    expect(screen.getByPlaceholderText("Type your message...")).toBeTruthy();
    // One group for both messages, announced once as Mara's.
    const list = screen.getByRole("list", { name: "Mara" });
    expect(within(list).getAllByText("Mara:")).toHaveLength(1);
  });
});
