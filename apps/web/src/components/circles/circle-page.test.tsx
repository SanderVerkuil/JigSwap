// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
  toastError: vi.fn<(message: string) => void>(),
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
  // ShellNotFound reads the path (to pad full-bleed routes).
  useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) => {
    const location = { pathname: "/circles/circle_1" };
    return opts?.select ? opts.select(location) : location;
  },
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));

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
  // The manage dialog resolves the viewer's member id from their Clerk id ("clerk_me" above).
  set(
    convexQuery(gateway.identity.byClerkId, { clerkId: "clerk_me" }).queryKey,
    { _id: "me" },
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
  it("shows a member their seat, the members and the leave action", () => {
    renderPage({ circle: detail() });
    // The page head (h1) already names the circle: the card doesn't repeat it,
    // and the sections sit directly under that h1.
    expect(screen.queryByRole("heading", { name: "Puzzle Club" })).toBeNull();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([en.circles.page.chatTitle, en.circles.page.sharedTitle]);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    // One meta line: the viewer's seat · the member count.
    const meta = screen.getByText("3 members").parentElement;
    expect(meta?.textContent).toBe("View only·3 members");
    const stack = screen.getByRole("group", { name: "Members of Puzzle Club" });
    expect(
      within(stack).getByRole("button", { name: "Bas · View only" }),
    ).toBeTruthy();
    expect(
      within(stack).getByRole("button", { name: "Anna · Owner" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leave circle" })).toBeTruthy();
    // Managing is Admin-only.
    expect(
      screen.queryByRole("button", { name: "Manage Puzzle Club" }),
    ).toBeNull();
  });

  describe("who a view-only member is told to ask", () => {
    it("falls back to another Admin when the owner's account is gone", () => {
      renderPage({
        circle: detail({
          members: [
            seat("gone", "", {
              isOwner: true,
              permission: "Admin",
              departed: true,
            }),
            seat("u_bas", "Bas", { permission: "Admin" }),
            seat("me", "Me"),
          ],
        }),
      });
      expect(screen.getByText(/Ask Bas for “Can exchange”/)).toBeTruthy();
    });

    it("says it generally, with no Message, when no admin is left to ask", () => {
      renderPage({
        circle: detail({
          members: [
            seat("gone", "", {
              isOwner: true,
              permission: "Admin",
              departed: true,
            }),
            seat("me", "Me"),
          ],
        }),
      });
      expect(screen.getByText(en.circles.page.viewOnlyHint)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: en.messages.messageButton }),
      ).toBeNull();
    });
  });

  describe("a circle with only its owner in it", () => {
    const alone = () =>
      detail({
        memberCount: 1,
        isOwnedByViewer: true,
        viewerPermission: "Admin",
        members: [seat("me", "Me", { isOwner: true, permission: "Admin" })],
      });

    it("prompts to invite people, opening Manage at the invite section", () => {
      renderPage({ circle: alone() });
      fireEvent.click(
        screen.getByRole("button", { name: en.circles.page.invitePeople }),
      );
      const invite = screen.getByRole("region", {
        name: en.circles.invite.title,
      });
      expect(
        within(screen.getByRole("dialog")).getByRole("region", {
          name: en.circles.invite.title,
        }),
      ).toBe(invite);
      // Focus lands on the section (scrolling it into view) without popping up a phone's keyboard.
      expect(document.activeElement).toBe(invite);
    });

    it("opens Manage at the top from Manage itself", () => {
      renderPage({ circle: alone() });
      fireEvent.click(
        screen.getByRole("button", { name: "Manage Puzzle Club" }),
      );
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
        true,
      );
      expect(document.activeElement).not.toBe(
        screen.getByRole("region", { name: en.circles.invite.title }),
      );
    });

    it("stops prompting once someone else joined", () => {
      renderPage({
        circle: detail({
          memberCount: 2,
          isOwnedByViewer: true,
          viewerPermission: "Admin",
        }),
      });
      expect(
        screen.queryByRole("button", { name: en.circles.page.invitePeople }),
      ).toBeNull();
    });

    it("never prompts someone who can't invite", () => {
      renderPage({ circle: detail({ memberCount: 1 }) });
      expect(
        screen.queryByRole("button", { name: en.circles.page.invitePeople }),
      ).toBeNull();
    });
  });

  it("offers an Admin owner the manage action and no leave", () => {
    renderPage({
      circle: detail({
        isOwnedByViewer: true,
        viewerPermission: "Admin",
      }),
    });
    expect(
      screen.getByRole("button", { name: "Manage Puzzle Club" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave circle" })).toBeNull();
  });

  it("shows a member their own permission, with what it allows", () => {
    renderPage({ circle: detail({ viewerPermission: "Exchange" }) });
    const badge = screen.getByRole("button", { name: "Can exchange" });
    act(() => badge.focus());
    expect(screen.getAllByRole("tooltip")[0].textContent).toBe(
      en.circles.roleHints.Exchange,
    );
    expect(screen.queryByText("Member")).toBeNull();
  });

  it("tells a view-only member why they can't share, instead of a share control", () => {
    renderPage({ circle: detail({ viewerPermission: "ViewOnly" }) });
    expect(screen.getByRole("button", { name: "View only" })).toBeTruthy();
    // The page names who to ask, and how to reach them.
    const hint = screen.getByText(/Ask Anna for “Can exchange”/);
    expect(hint).toBeTruthy();
    expect(hint.parentElement?.textContent).toContain(
      en.messages.messageButton,
    );
    expect(screen.queryByText(en.circles.manage.shareCopy)).toBeNull();
  });

  it("gives a member who may share the share control and no view-only note", () => {
    renderPage({ circle: detail({ viewerPermission: "Exchange" }) });
    expect(screen.getByText(en.circles.manage.shareCopy)).toBeTruthy();
    expect(screen.queryByText(/“Can exchange”/)).toBeNull();
  });

  it("names the owner's seat Owner (nl)", () => {
    renderPage({
      circle: detail({ isOwnedByViewer: true, viewerPermission: "Admin" }),
      locale: "nl",
    });
    expect(screen.getByRole("button", { name: "Eigenaar" })).toBeTruthy();
    expect(screen.queryByText(/“Mag ruilen”/)).toBeNull();
  });

  it("renders the generic not-found page for a non-member or an unknown circle", () => {
    renderPage({ circle: null, threadId: null });
    // The title moved into the page head (pinned in circle-page-not-found.test.tsx).
    expect(screen.getByText(en.notFound.description)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: en.notFound.backToDashboard })
        .getAttribute("href"),
    ).toBe("/dashboard");
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
    // The preview quotes the group chat: it stays out of PostHog capture.
    expect(
      screen.getByText("Bas: Who has the Wasgij?").closest(".ph-no-capture"),
    ).not.toBeNull();
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

  describe("the manage dialog's member rows (SEC-86)", () => {
    // Each member row of the open manage dialog, in seat order: is the level select enabled, and is
    // there a remove button next to it?
    const memberRows = () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Manage Puzzle Club" }),
      );
      const section = within(screen.getByRole("dialog"))
        .getByRole("heading", { name: "Members" })
        .closest("section");
      if (!section) throw new Error("the dialog has no members section");
      return within(section)
        .getAllByRole("combobox")
        .map((trigger) => ({
          canChange: !(trigger as HTMLButtonElement).disabled,
          canRemove:
            trigger.parentElement !== null &&
            within(trigger.parentElement).queryByRole("button") !== null,
        }));
    };
    const LOCKED = { canChange: false, canRemove: false };
    const OPEN = { canChange: true, canRemove: true };

    it("locks the owner's and another Admin's row for a non-owner Admin", () => {
      renderPage({
        circle: detail({
          viewerPermission: "Admin",
          members: [
            seat("u_anna", "Anna", { isOwner: true, permission: "Admin" }),
            seat("u_bas", "Bas", { permission: "Admin" }),
            seat("u_cas", "Cas", { permission: "Exchange" }),
            seat("me", "Me", { permission: "Admin" }),
          ],
        }),
      });

      expect(memberRows()).toEqual([
        LOCKED,
        LOCKED,
        OPEN,
        // Their own level stays changeable (stepping down); walking out is Leave.
        { canChange: true, canRemove: false },
      ]);
    });

    it("leaves every other Admin's row open to the owner", () => {
      renderPage({
        circle: detail({
          isOwnedByViewer: true,
          viewerPermission: "Admin",
          members: [
            seat("me", "Me", { isOwner: true, permission: "Admin" }),
            seat("u_bas", "Bas", { permission: "Admin" }),
            seat("u_cas", "Cas", { permission: "Exchange" }),
          ],
        }),
      });

      expect(memberRows()).toEqual([LOCKED, OPEN, OPEN]);
    });

    it("names the remove button after its member, and says so when the removal fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.mutation.mockRejectedValueOnce(new Error("offline"));
      renderPage({
        circle: detail({
          isOwnedByViewer: true,
          viewerPermission: "Admin",
          members: [
            seat("me", "Me", { isOwner: true, permission: "Admin" }),
            seat("u_bas", "Bas"),
          ],
        }),
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Manage Puzzle Club" }),
      );

      fireEvent.click(screen.getByRole("button", { name: "Remove Bas" }));

      await vi.waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(
          "Couldn't remove Bas. Please try again.",
        ),
      );
    });
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
