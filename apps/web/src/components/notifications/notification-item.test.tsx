// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { NotificationView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { actionsFor } from "./notification-actions";
import { NotificationItem } from "./notification-item";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  query: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// Router-free links: the test asserts the row's DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    hash,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string>;
    hash?: string;
    children?: ReactNode;
  }) => (
    <a
      href={`${to}${search ? `?${new URLSearchParams(search)}` : ""}${hash ? `#${hash}` : ""}`}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => ({
    query: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      mocks.query(getFunctionName(ref), args),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const ACT = getFunctionName(gateway.notifications.act);
const UNFOLLOW = getFunctionName(gateway.social.unfollow);
const CANCEL = getFunctionName(gateway.social.cancelFollowRequest);
const RELATION = getFunctionName(gateway.social.followRelation);

const mara = {
  anonymous: false as const,
  memberId: "member_mara",
  name: "Mara",
  handle: "mara",
};

const base = (over: Partial<NotificationView> = {}): NotificationView => ({
  id: "n1",
  type: "new_follower",
  isRead: false,
  createdAt: Date.now() - 60_000,
  actors: [mara],
  actorCount: 1,
  context: {},
  href: "/members/mara",
  state: "informational",
  availableActions: [],
  ...over,
});

type Seed = { preview?: unknown };

const renderItem = (
  view: NotificationView,
  {
    surface = "page",
    locale = "en",
    seed = {},
  }: { surface?: "page" | "popover"; locale?: "en" | "nl"; seed?: Seed } = {},
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
        // Nothing reaches a server: unseeded queries just stay loading.
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  const actor = view.actors[0];
  if (seed.preview !== undefined && actor && !actor.anonymous) {
    queryClient.setQueryData(
      convexQuery(gateway.social.followRequesterPreview, {
        requesterId: actor.memberId as never,
      }).queryKey,
      seed.preview,
    );
  }
  const onOpen = vi.fn();
  const onMarkRead = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ul>
          <NotificationItem
            view={view}
            surface={surface}
            onOpen={onOpen}
            onMarkRead={surface === "page" ? onMarkRead : undefined}
          />
        </ul>
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onOpen, onMarkRead };
};

const rowLink = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-row-link]");

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.query.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("NotificationItem rendering", () => {
  it("renders an informational row as a stretched link with a bold actor and sr-only unread", () => {
    const { container } = renderItem(base());
    const link = rowLink(container)!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/members/mara");
    expect(link.textContent).toBe("Unread, Mara started following you.");
    expect(link.querySelector("strong")?.textContent).toBe("Mara");
    expect(link.querySelector(".sr-only")?.textContent).toBe("Unread, ");
    expect(screen.queryByRole("button", { name: /follow back/i })).toBeNull();
  });

  it("never nests interactive elements inside the row link", () => {
    const views: NotificationView[] = [
      base({ state: "actionable", availableActions: ["follow_back"] }),
      base({
        type: "follow_request_received",
        state: "actionable",
        availableActions: [
          "approve_follow_request",
          "approve_and_follow_back",
          "decline_follow_request",
        ],
      }),
      base({
        type: "message_received",
        href: "/messages/t1",
        state: "actionable",
        availableActions: ["reply_message"],
        context: { messagePreview: "Hi there" },
      }),
    ];
    for (const view of views) {
      const { container } = renderItem(view);
      const link = rowLink(container)!;
      expect(link.querySelector("a, button, [role=button]")).toBeNull();
      // The actions do render, as siblings of the link.
      expect(
        container.querySelectorAll("li button, li a").length,
      ).toBeGreaterThan(1);
      cleanup();
    }
  });

  it("renders the server href with its search param (trades deep link) and the status chip", () => {
    const { container } = renderItem(
      base({
        type: "trade_request",
        href: "/trades?exchange=ex_1",
        context: { puzzleTitle: "Starry Night", exchangeStatus: "accepted" },
      }),
    );
    const link = rowLink(container)!;
    expect(link.getAttribute("href")).toBe("/trades?exchange=ex_1");
    expect(link.textContent).toContain("Mara wants to trade for Starry Night.");
    expect(screen.getByText("Accepted")).toBeTruthy();
    // No inline accept/decline for trades.
    expect(container.querySelectorAll("button").length).toBe(1); // mark read
  });

  it("renders a resolved row as a status chip without actions", () => {
    renderItem(base({ state: "resolved", resolvedAs: "following_each_other" }));
    expect(screen.getByRole("status").textContent).toContain(
      "You follow each other",
    );
    expect(screen.queryByRole("button", { name: /follow back/i })).toBeNull();
  });

  it("mutes an unavailable row and says so", () => {
    const { container } = renderItem(
      base({
        type: "puzzle_approved",
        actors: [],
        actorCount: 0,
        href: "/puzzles",
        state: "unavailable",
        context: { puzzleTitle: "Gone", thumbnailUrl: "https://x/y.png" },
      }),
    );
    expect(container.querySelector("li")?.className).toContain("opacity-70");
    expect(container.querySelector("img")?.className).toContain("grayscale");
    expect(screen.getByText("No longer available")).toBeTruthy();
  });

  it("names an anonymous actor 'Former member' and a nameless one 'Puzzler' (en + nl)", () => {
    renderItem(base({ actors: [{ anonymous: true }], href: null }));
    expect(screen.getByText("Former member")).toBeTruthy();
    cleanup();
    renderItem(base({ actors: [{ anonymous: true }], href: null }), {
      locale: "nl",
    });
    expect(screen.getByText("Voormalig lid")).toBeTruthy();
    cleanup();
    renderItem(
      base({
        actors: [{ anonymous: false, memberId: "m2", handle: "m2" }],
      }),
    );
    expect(screen.getByText("Puzzler")).toBeTruthy();
  });

  it.each([
    ["en", "Puzzler declined your trade for Starry Night."],
    ["nl", "Puzzelaar"],
  ] as const)(
    "names a privacy-hidden trade_declined actor generically, not 'Former member' (%s)",
    (locale, text) => {
      const { container } = renderItem(
        base({
          type: "trade_declined",
          actors: [{ anonymous: true }],
          href: "/trades?exchange=ex_1",
          context: { puzzleTitle: "Starry Night" },
        }),
        { locale },
      );
      const sentence = rowLink(container)!.textContent;
      expect(sentence).toContain(text);
      expect(sentence).not.toMatch(/Former member|Voormalig lid/);
    },
  );

  it.each([
    [
      "en",
      "circle_invite_received",
      "Mara invited you to join Saturday Puzzlers.",
    ],
    [
      "nl",
      "circle_invite_received",
      "Mara heeft je uitgenodigd voor Saturday Puzzlers.",
    ],
    [
      "en",
      "circle_invite_accepted",
      "Mara accepted your invitation to Saturday Puzzlers.",
    ],
    [
      "nl",
      "circle_invite_accepted",
      "Mara heeft je uitnodiging voor Saturday Puzzlers geaccepteerd.",
    ],
  ] as const)(
    "%s: %s names the actor and the live circle name",
    (locale, type, text) => {
      const { container } = renderItem(
        base({
          type,
          href: "/circles",
          context: { circleName: "Saturday Puzzlers" },
        }),
        { locale },
      );
      expect(rowLink(container)!.textContent).toContain(text);
    },
  );

  it("names a privacy-hidden circle inviter generically and falls back to 'a circle'", () => {
    const { container } = renderItem(
      base({
        type: "circle_invite_received",
        actors: [{ anonymous: true }],
        href: "/circles",
      }),
    );
    const sentence = rowLink(container)!.textContent;
    expect(sentence).toContain("Puzzler invited you to join a circle.");
    expect(sentence).not.toMatch(/Former member/);
  });

  it.each([
    ["en", "Former member declined your trade for Starry Night."],
    ["nl", "Voormalig lid"],
  ] as const)(
    "names a departed trade_declined actor 'Former member' (%s)",
    (locale, text) => {
      const { container } = renderItem(
        base({
          type: "trade_declined",
          actors: [{ anonymous: true, departed: true }],
          href: "/trades?exchange=ex_1",
          context: { puzzleTitle: "Starry Night" },
        }),
        { locale },
      );
      expect(rowLink(container)!.textContent).toContain(text);
    },
  );

  it.each([
    ["en", undefined, "Mara sent you a message."],
    ["en", "image", "Mara sent a photo."],
    ["en", "location", "Mara shared a location."],
    ["nl", "image", "Mara heeft een foto gestuurd."],
    ["nl", "location", "Mara heeft een locatie gedeeld."],
  ] as const)(
    "names a message_received by its media kind (%s, %s)",
    (locale, messageKind, text) => {
      const { container } = renderItem(
        base({
          type: "message_received",
          href: "/messages/t1",
          context: messageKind ? { messageKind } : {},
        }),
        { locale },
      );
      expect(rowLink(container)!.textContent).toContain(text);
    },
  );

  it("never links a trade-revealed actor's profile: the row opens the trade", () => {
    const { container } = renderItem(
      base({
        type: "trade_accepted",
        actors: [{ ...mara, tradeRevealed: true }],
        href: "/trades?exchange=ex_1",
        context: { puzzleTitle: "Starry Night" },
      }),
    );
    expect(container.querySelector('a[href^="/members/"]')).toBeNull();
    expect(rowLink(container)!.getAttribute("href")).toBe(
      "/trades?exchange=ex_1",
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("an unread row without a destination is a stretched mark-read button", () => {
    const { container, onOpen } = renderItem(
      base({ actors: [{ anonymous: true }], href: null }),
    );
    const target = rowLink(container)!;
    expect(target.tagName).toBe("BUTTON");
    fireEvent.click(target);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("falls back to the legacy copy for a ref-less row", () => {
    const { container } = renderItem(
      base({ actors: [], actorCount: 0, href: "/people" }),
    );
    expect(rowLink(container)!.textContent).toBe(
      "Unread, Someone started following you.",
    );
  });

  it.each([
    ["en", "Unread, Mara started following you."],
    ["nl", "Ongelezen, Mara volgt je nu."],
  ] as const)(
    "names a ref-less row's actor from the stored snapshot (%s)",
    (locale, text) => {
      const { container } = renderItem(
        base({
          actors: [],
          actorCount: 0,
          href: "/people",
          context: { actorNameSnapshot: "Mara" },
        }),
        { locale },
      );
      expect(rowLink(container)!.textContent).toBe(text);
    },
  );

  it("renders a grouped new_follower with stacked avatars and a grouped sentence", () => {
    const { container } = renderItem(
      base({
        actors: [
          mara,
          { anonymous: false, memberId: "m2", name: "Joost", handle: "joost" },
          { anonymous: false, memberId: "m3", name: "Anna", handle: "anna" },
        ],
        actorCount: 5,
        href: "/people",
      }),
    );
    expect(rowLink(container)!.textContent).toBe(
      "Unread, Mara, Joost and 3 others followed you.",
    );
    expect(container.textContent).toContain("+2");
  });

  it("shows the review rating and the reject reason as context", () => {
    renderItem(base({ type: "review_received", context: { rating: 4 } }));
    expect(screen.getByRole("img", { name: "4 out of 5 stars" })).toBeTruthy();
    cleanup();
    renderItem(
      base({
        type: "proposal_rejected",
        actors: [],
        actorCount: 0,
        context: { puzzleTitle: "Sterrennacht", reason: "Duplicate" },
      }),
    );
    expect(screen.getByText("Reason: Duplicate")).toBeTruthy();
  });

  it("renders report outcomes with the decision, ground and statement of reasons, no actor", () => {
    const { container } = renderItem(
      base({
        type: "content_removed",
        actors: [],
        actorCount: 0,
        href: null,
        context: {
          restrictedContent: "photo",
          ground: "sexual",
          reason: "Nudity",
        },
      }),
    );
    expect(container.textContent).toContain(
      "A moderator removed one of your photos for sexual or inappropriate content. This was decided by a person, not automatically. Reply via the contact page to request a review.",
    );
    expect(screen.getByText("Reason: Nudity")).toBeTruthy();
    cleanup();
    const decided = renderItem(
      base({
        type: "report_decided",
        actors: [],
        actorCount: 0,
        href: null,
        context: { reportDecision: "dismissed" },
      }),
      { locale: "nl" },
    );
    expect(decided.container.textContent).toContain(
      "We hebben je melding beoordeeld en geen overtreding gevonden, dus er is niets veranderd.",
    );
  });

  it("popover: only the primary follow-request actions, no overflow, no mark-read", () => {
    const view = base({
      type: "follow_request_received",
      state: "actionable",
      availableActions: [
        "approve_follow_request",
        "approve_and_follow_back",
        "decline_follow_request",
      ],
    });
    renderItem(view, { surface: "popover" });
    expect(
      screen.getByRole("button", { name: "Approve Mara's follow request" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Decline Mara's follow request" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    expect(screen.getByText("@mara")).toBeTruthy();
    cleanup();
    renderItem(view);
    expect(
      screen.getByRole("button", { name: "More actions for Mara" }),
    ).toBeTruthy();
  });
});

describe("rich sentences", () => {
  const TYPES = Object.keys(
    en.notifications.copy,
  ) as NotificationView["type"][];

  it.each(["en", "nl"] as const)(
    "%s renders every type with and without context, never a raw key or placeholder",
    (locale) => {
      for (const type of TYPES) {
        for (const context of [{}, { puzzleTitle: "P", goalTitle: "G" }]) {
          const { container } = renderItem(base({ type, context }), {
            locale,
          });
          const text = rowLink(container)!.textContent ?? "";
          expect(text, type).not.toMatch(/rich\.|copy\.|undefined|null|[{}<>]/);
          expect(text.length, type).toBeGreaterThan(10);
          cleanup();
        }
      }
    },
  );

  it.each([
    ["en", "Unread, You have a new message."],
    ["nl", "Ongelezen, Je hebt een nieuw bericht."],
  ] as const)(
    "a privacy-hidden message sender gets a nameless sentence, not 'Former member' (%s)",
    (locale, text) => {
      const { container } = renderItem(
        base({
          type: "message_received",
          actors: [{ anonymous: true }],
          href: "/messages/t1",
        }),
        { locale },
      );
      expect(rowLink(container)!.textContent).toBe(text);
    },
  );

  it("a departed message sender is still a 'Former member'", () => {
    const { container } = renderItem(
      base({
        type: "message_received",
        actors: [{ anonymous: true, departed: true }],
        href: "/messages/t1",
      }),
    );
    expect(rowLink(container)!.textContent).toBe(
      "Unread, Former member sent you a message.",
    );
  });

  it("has a chip label for every resolved state each actionable type can reach", () => {
    const reachable: Record<string, string[]> = {
      new_follower: ["following_each_other", "following", "requested"],
      follow_request_approved: [
        "following_each_other",
        "following",
        "requested",
      ],
      follow_request_received: ["approved", "declined", "expired"],
      household_invite_received: ["joined", "declined", "expired"],
    };
    const rich = en.notifications.rich as unknown as Record<
      string,
      { resolved?: Record<string, string> }
    >;
    for (const [type, states] of Object.entries(reachable)) {
      expect(Object.keys(rich[type].resolved ?? {}).sort()).toEqual(
        [...states].sort(),
      );
    }
  });
});

describe("actionsFor", () => {
  it("keeps trades and messages out of the popover and puts approve & follow back in the overflow", () => {
    expect(
      actionsFor(
        { type: "message_received", availableActions: ["reply_message"] },
        "popover",
      ),
    ).toEqual({ inline: [], overflow: [] });
    expect(
      actionsFor(
        {
          type: "follow_request_received",
          availableActions: [
            "approve_follow_request",
            "approve_and_follow_back",
            "decline_follow_request",
          ],
        },
        "page",
      ),
    ).toEqual({
      inline: ["approve_follow_request", "decline_follow_request"],
      overflow: ["approve_and_follow_back"],
    });
  });
});

describe("NotificationActions", () => {
  const followable = base({
    state: "actionable",
    availableActions: ["follow_back"],
  });

  it("follow back: spins, then flips to a focused chip and offers a 5 s Undo that unfollows", async () => {
    let resolve!: (value: unknown) => void;
    mocks.mutation.mockImplementation((name) =>
      name === ACT
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(null),
    );
    renderItem(followable);
    const button = screen.getByRole("button", { name: "Follow back Mara" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(mocks.mutation).toHaveBeenCalledWith(ACT, {
      notificationId: "n1",
      action: "follow_back",
    });

    await act(async () => resolve({ resolvedAs: "following" }));
    const chip = screen.getByRole("status");
    expect(chip.textContent).toContain("Following");
    expect(document.activeElement).toBe(chip);

    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    const [message, options] = mocks.toastSuccess.mock.calls[0];
    expect(message).toBe("You now follow Mara.");
    expect(options.duration).toBe(5000);
    expect(options.action.label).toBe("Undo");

    await act(async () => options.action.onClick());
    expect(mocks.mutation).toHaveBeenCalledWith(UNFOLLOW, {
      followeeId: "member_mara",
    });
    // Undo restores the button until the reactive view arrives.
    expect(
      screen.getByRole("button", { name: "Follow back Mara" }),
    ).toBeTruthy();
  });

  it("follow back on a private member reads Requested; Undo withdraws the request", async () => {
    mocks.mutation.mockResolvedValue({ resolvedAs: "requested" });
    mocks.query.mockResolvedValue({
      following: false,
      followsYou: true,
      targetIsPrivate: true,
      pendingRequest: { requestId: "fr_1", requestedAt: 1 },
    });
    renderItem(followable);
    fireEvent.click(screen.getByRole("button", { name: "Follow back Mara" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Requested"),
    );
    const [message, options] = mocks.toastSuccess.mock.calls[0];
    expect(message).toBe("Follow request sent to Mara.");
    await act(async () => options.action.onClick());
    expect(mocks.query).toHaveBeenCalledWith(RELATION, {
      memberId: "member_mara",
    });
    expect(mocks.mutation).toHaveBeenCalledWith(CANCEL, { requestId: "fr_1" });
  });

  it("no Undo for other actions", async () => {
    mocks.mutation.mockResolvedValue({ resolvedAs: "approved" });
    renderItem(
      base({
        type: "follow_request_received",
        state: "actionable",
        availableActions: ["approve_follow_request", "decline_follow_request"],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Approve Mara's follow request" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Approved"),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("a stale action renders the server's chip without an error toast", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({
        code: "NOTIFICATION_ACTION_STALE",
        resolvedAs: "following_each_other",
      }),
    );
    renderItem(followable);
    fireEvent.click(screen.getByRole("button", { name: "Follow back Mara" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "You follow each other",
      ),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("a failure toasts, brings the buttons back and returns focus to the failed one", async () => {
    mocks.mutation.mockRejectedValue(new Error("network"));
    renderItem(
      base({
        type: "household_invite_received",
        href: "/household",
        state: "actionable",
        availableActions: [
          "accept_household_invite",
          "decline_household_invite",
        ],
      }),
    );
    const accept = screen.getByRole("button", {
      name: "Accept Mara's household invite",
    });
    fireEvent.click(accept);
    expect(
      (
        screen.getByRole("button", {
          name: "Decline Mara's household invite",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't accept Mara's invite. Try again.",
      ),
    );
    await waitFor(() => expect(document.activeElement).toBe(accept));
    expect(accept.getAttribute("aria-busy")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Decline Mara's household invite",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("RequesterPreview", () => {
  const pending = base({
    type: "follow_request_received",
    state: "actionable",
    availableActions: ["approve_follow_request", "decline_follow_request"],
  });

  it("shows the pending requester's minimal identity when expanded", () => {
    renderItem(pending, {
      seed: {
        preview: {
          memberId: "member_mara",
          displayName: "Mara de Vries",
          handle: "mara",
          memberSince: Date.UTC(2024, 2, 1),
          visibility: "private",
          requestedAt: 1,
        },
      },
    });
    const toggle = screen.getByRole("button", {
      name: "View Mara's profile summary",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    expect(within(panel).getByText("Mara de Vries")).toBeTruthy();
    expect(within(panel).getByText("@mara")).toBeTruthy();
    expect(within(panel).getByText("Member since March 2024")).toBeTruthy();
    expect(within(panel).getByText("Private profile")).toBeTruthy();
    expect(
      within(panel)
        .getByRole("link", { name: "Open profile" })
        .getAttribute("href"),
    ).toBe("/members/mara");
  });

  it("shows nothing extra once the request is no longer pending", () => {
    renderItem(pending, { seed: { preview: null } });
    const toggle = screen.getByRole("button", {
      name: "View Mara's profile summary",
    });
    fireEvent.click(toggle);
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    expect(panel.textContent).toBe("");
  });

  it("is not offered on a resolved request", () => {
    renderItem(
      base({
        type: "follow_request_received",
        state: "resolved",
        resolvedAs: "approved",
      }),
    );
    expect(
      screen.queryByRole("button", { name: /profile summary/i }),
    ).toBeNull();
  });
});
