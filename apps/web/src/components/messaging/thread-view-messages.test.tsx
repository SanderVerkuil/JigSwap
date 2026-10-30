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
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
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

const mara = {
  _id: "member_mara",
  _creationTime: 0,
  name: "Mara",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
};

const threadOf = (subject: InboxThread["subject"]): InboxThread => ({
  threadId: "thread_1",
  subject,
  lastMessage: null,
  unreadCount: 0,
  contextCopies: [],
  updatedAt: 0,
});

const dmThread = () =>
  threadOf({
    kind: "dm",
    otherMember: { anonymous: false, member: mara },
    profileHandle: "mara",
  });

// Exchange threads carry the trading partner (otherMember) like a DM.
const exchangeThread = () =>
  threadOf({
    kind: "exchange",
    exchangeId: "exchange_1",
    exchangeType: "trade",
    puzzleTitle: "Night Harbour",
    otherMember: { anonymous: false, member: mara },
    profileHandle: "mara",
  });

// #160: messages carry viewer-relative `isMine`, never a raw author id.
const MESSAGES = [
  { id: "m1", isMine: true, kind: "text", body: "My own message", sentAt: 1 },
  {
    id: "m2",
    isMine: false,
    kind: "text",
    body: "Mara's message",
    sentAt: 2,
  },
  {
    id: "m3",
    isMine: false,
    kind: "system",
    body: "Trade accepted",
    sentAt: 3,
  },
  {
    id: "m4",
    isMine: false,
    kind: "text",
    body: "",
    sentAt: 4,
    removed: true,
  },
  {
    id: "m5",
    isMine: false,
    kind: "system",
    body: "exchange_completed",
    tradeEvent: { kind: "completed" },
    sentAt: 5,
  },
];

const renderThread = (
  thread: InboxThread,
  locale: "en" | "nl" = "en",
  // exchange.replyDisclosure for an exchange thread; unseeded = still loading.
  replyDisclosure?: { revealsYou: boolean } | null,
  // The thread's own inbox row (getInboxThread); null when the inbox wouldn't list it;
  // "unsupported" for a backend without getInboxThread, whose inbox first page holds the thread.
  header: InboxThread | null | "unsupported" = thread,
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
  mocks.messages = MESSAGES;
  const headerKey = convexQuery(gateway.conversation.getInboxThread, {
    threadId: thread.threadId,
  }).queryKey;
  if (header === "unsupported") {
    queryClient.setQueryDefaults(headerKey, {
      queryFn: () =>
        Promise.reject(new Error("Could not find public function")),
    });
    queryClient.setQueryData(
      convexQuery(gateway.conversation.getMyInbox, {}).queryKey,
      [thread],
    );
  } else {
    queryClient.setQueryData(headerKey, header);
  }
  if (replyDisclosure !== undefined && thread.subject.kind === "exchange") {
    queryClient.setQueryData(
      convexQuery(gateway.exchange.replyDisclosure, {
        exchangeId: thread.subject.exchangeId,
      }).queryKey,
      replyDisclosure,
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

describe("ThreadView header", () => {
  // The inbox list holds only its newest page; the header reads the thread's
  // own row, so a thread opened from a link far down the inbox keeps its title.
  it("titles the thread from its own inbox row, without the inbox list", () => {
    renderThread(exchangeThread());
    expect(
      screen.getByRole("heading", { name: "Trade: Night Harbour" }),
    ).toBeTruthy();
  });

  it("falls back to a generic title when the inbox wouldn't list the thread", () => {
    renderThread(dmThread(), "en", undefined, null);
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeTruthy();
    expect(screen.getByText("Mara's message")).toBeTruthy();
  });

  // The web can deploy before the backend that serves getInboxThread.
  it("finds its row in the inbox when the backend has no getInboxThread", async () => {
    renderThread(exchangeThread(), "en", undefined, "unsupported");
    expect(
      await screen.findByRole("heading", { name: "Trade: Night Harbour" }),
    ).toBeTruthy();
  });
});

describe("ThreadView message actions", () => {
  it("keeps the conversation out of PostHog capture", () => {
    renderThread(dmThread());
    expect(
      screen.getByText("Mara's message").closest(".ph-no-capture"),
    ).not.toBeNull();
  });

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
    // The quote renders in a portal, outside the thread's capture block.
    expect(dialog.querySelector("blockquote.ph-no-capture")).not.toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Also block Mara" }),
    ).toBeTruthy();
  });

  it("offers Also block {name} when reporting a message in an exchange thread", async () => {
    renderThread(exchangeThread());
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "More actions for message from Mara",
      }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Report message" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Report Mara" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Also block Mara" }),
    ).toBeTruthy();
  });

  it("byMe: the header menu stays, with Report {name} only, and the report has no Also block", async () => {
    // No quick links (profileHandle null), so Report is the menu's only item.
    renderThread({
      ...threadOf({
        kind: "dm",
        otherMember: { anonymous: false, member: mara },
        profileHandle: null,
      }),
      blocked: "byMe",
    });
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Conversation options" }),
      { key: "Enter" },
    );
    await screen.findByRole("menuitem", { name: "Report Mara" });
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Report Mara"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report Mara" }));
    expect(
      await screen.findByRole("dialog", { name: "Report Mara" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "Also block Mara" }),
    ).toBeNull();
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

describe("ThreadView header", () => {
  // UX-02: a narrow thread pane shows the quick link as its icon only; the
  // label stays its accessible name and its tooltip.
  it("keeps the inline quick link named, with a tooltip, when it shows only its icon", () => {
    renderThread(dmThread());
    const link = screen.getByRole("link", { name: "View profile" });
    expect(link.getAttribute("href")).toBe("/members/mara");
    expect(link.getAttribute("title")).toBe("View profile");
  });
});

describe("ThreadView photos", () => {
  const img = (id: string, sentAt: number, body = "") => ({
    id,
    isMine: false,
    kind: "image",
    body,
    sentAt,
    attachmentId: `att-${id}`,
    attachment: { status: "ready", url: `https://files.test/${id}.jpg` },
  });

  const setup = (pending: unknown[] = []) => {
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
      dmThread(),
    );
    queryClient.setQueryData(
      convexQuery(gateway.conversation.listMyPendingAttachments, {
        threadId: "thread_1",
      }).queryKey,
      pending,
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

  it("groups photos sent within a minute into a gallery, with the caption beside it", () => {
    mocks.messages = [img("p1", 1_000), img("p2", 20_000, "Our holiday")];
    setup();
    expect(
      screen.getByRole("button", { name: "Photo 1 of 2, open" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Photo 2 of 2, open" }),
    ).toBeTruthy();
    expect(screen.getByText("Our holiday")).toBeTruthy();
    // The caption bubble carries its message's More menu.
    expect(
      screen.getAllByRole("button", {
        name: "More actions for message from Mara",
      }),
    ).toHaveLength(1);
  });

  it("renders formatting in a text bubble and a photo caption", () => {
    mocks.messages = [
      { id: "t1", isMine: false, kind: "text", body: "**bold** hi", sentAt: 1 },
      img("p1", 100_000, "_holiday_"),
    ];
    setup();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("holiday").tagName).toBe("EM");
  });

  it("announces an arriving message without its formatting markers", async () => {
    mocks.messages = [MESSAGES[0]];
    const { rerender } = setup();
    mocks.messages = [
      MESSAGES[0],
      {
        id: "t2",
        isMine: false,
        kind: "text",
        body: "**hi** _there_",
        sentAt: 10,
      },
    ];
    rerender();
    const region = document.querySelector("[aria-live='polite']");
    await waitFor(() => expect(region?.textContent).toContain("hi there"));
    expect(region?.textContent).not.toContain("*");
  });

  it("shows my sent photos being checked at the end of the thread", () => {
    mocks.messages = [MESSAGES[0]];
    setup([
      {
        attachmentId: "att9",
        status: "pending",
        sendRequested: true,
        createdAt: 5,
      },
    ]);
    expect(screen.getByText("Checking photo…")).toBeTruthy();
  });

  it("announces an arriving photo without caption as '{name} sent a photo'", async () => {
    mocks.messages = [MESSAGES[0]];
    const { rerender } = setup();
    mocks.messages = [MESSAGES[0], img("p1", 10)];
    rerender();
    const region = document.querySelector("[aria-live='polite']");
    await waitFor(() => expect(region?.textContent).toBe("Mara sent a photo"));
  });
  const place = (id: string, sentAt: number, body = "") => ({
    id,
    isMine: false,
    kind: "location",
    body,
    sentAt,
    attachmentId: `att-${id}`,
    attachment: {
      kind: "location",
      lat: 52.09074,
      lng: 5.12142,
      precision: "approximate",
      label: "Domplein",
      mapUrl: `https://files.test/${id}.png`,
      openUrl: "https://www.openstreetmap.org/?mlat=52.09074&mlon=5.12142",
    },
  });

  it("renders a shared location as its map card, with its caption and More menu", () => {
    mocks.messages = [place("l1", 1_000, "See you here")];
    setup();
    expect(screen.getByRole("img", { name: "Map of Domplein" })).toBeTruthy();
    expect(screen.getByText("Approximate area")).toBeTruthy();
    expect(screen.getByText("See you here")).toBeTruthy();
    expect(
      screen.getAllByRole("button", {
        name: "More actions for message from Mara",
      }),
    ).toHaveLength(1);
  });

  it("announces an arriving location as '{name} shared a location'", async () => {
    mocks.messages = [MESSAGES[0]];
    const { rerender } = setup();
    mocks.messages = [MESSAGES[0], place("l1", 10, "Here")];
    rerender();
    const region = document.querySelector("[aria-live='polite']");
    await waitFor(() =>
      expect(region?.textContent).toBe("Mara shared a location"),
    );
  });
});

describe("ThreadView trade lifecycle lines", () => {
  it("renders a trade line from its tradeEvent in the reader's language", () => {
    renderThread(exchangeThread(), "nl");
    expect(screen.getByText("Uitwisseling voltooid")).toBeTruthy();
    expect(screen.queryByText("exchange_completed")).toBeNull();
  });

  it("renders it in English for an English reader, and an unmapped system line as its body", () => {
    renderThread(exchangeThread());
    expect(screen.getByText("Exchange completed")).toBeTruthy();
    expect(screen.getByText("Trade accepted")).toBeTruthy();
  });
});

describe("ThreadView reply reveal hint (SEC-08)", () => {
  const HINT = /^Replying shows Mara your name, handle and the reviews/;

  it("warns the exchange owner above the composer before their first reply", () => {
    renderThread(exchangeThread(), "en", { revealsYou: true });
    const hint = screen.getByText(HINT);
    const composer = screen.getByRole("textbox", {
      name: "Message Trade: Night Harbour",
    });
    expect(
      hint.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("says nothing once a reply reveals nothing new, to the requester, or in a DM", () => {
    renderThread(exchangeThread(), "en", { revealsYou: false });
    expect(screen.queryByText(HINT)).toBeNull();
    cleanup();
    renderThread(exchangeThread(), "en", null);
    expect(screen.queryByText(HINT)).toBeNull();
    cleanup();
    renderThread(dmThread());
    expect(screen.queryByText(HINT)).toBeNull();
  });
});
