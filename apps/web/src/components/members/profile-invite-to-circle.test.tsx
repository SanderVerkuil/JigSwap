// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
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
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ProfileBody, type PublicProfileView } from "./profile-body";

// "Invite to a circle…" on a member's profile (UX-128): offered only to a circle Admin who
// follows the member both ways, and it sends sharing.inviteToCircle.

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
// Out of scope here: the hero's follow/message buttons and the listings.
vi.mock("@/components/social/follow-button", () => ({
  FollowButton: () => null,
}));
vi.mock("@/components/social/message-button", () => ({
  MessageButton: () => null,
}));
vi.mock("@/components/members/profile-listings", () => ({
  ProfileCompletionsSection: () => null,
  ProfilePuzzlesSection: () => null,
}));

type Relation = FunctionReturnType<typeof gateway.social.followRelation>;
type Circles = FunctionReturnType<typeof gateway.sharing.myCircles>;

const ANNA = "member_anna" as Id<"users">;
const INVITE = getFunctionName(gateway.sharing.inviteToCircle);

const relation = (following: boolean, followsYou: boolean): Relation => ({
  following,
  followsYou,
  targetIsPrivate: false,
  pendingRequest: null,
});

const circle = (
  aggregateId: string,
  name: string,
  viewerPermission: Circles[number]["viewerPermission"],
): Circles[number] => ({
  _id: `row_${aggregateId}`,
  aggregateId,
  name,
  memberCount: 3,
  isOwnedByViewer: viewerPermission === "Admin",
  viewerPermission,
  createdAt: 0,
});

const PROFILE = {
  locked: false,
  hero: {
    memberId: ANNA,
    displayName: "Anna",
    slug: "anna",
    memberSince: Date.UTC(2024, 0, 1),
    visibility: "public",
    followerCount: 1,
    followingCount: 1,
    reviewCount: 0,
    rating: 0,
  },
  stats: { puzzlesOwned: 0, completions: 0, piecesPlaced: 0, swaps: 0 },
  records: {},
  currentlySolving: [],
  libraryScope: "available",
} as unknown as PublicProfileView;

const renderProfile = ({
  follow,
  circles,
  locale = "en",
}: {
  follow: Relation;
  circles: Circles;
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
  queryClient.setQueryData(
    convexQuery(gateway.social.followRelation, { memberId: ANNA }).queryKey,
    follow,
  );
  queryClient.setQueryData(
    convexQuery(gateway.sharing.myCircles, {}).queryKey,
    circles,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ProfileBody profile={PROFILE} viewer="member" />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const openMenu = (name = "More actions for Anna") => {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
};

const ADMIN_CIRCLES = [
  circle("c_club", "Puzzle Club", "Exchange"),
  circle("c_family", "Family", "Admin"),
  circle("c_friends", "Friends", "Admin"),
];

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
});
afterEach(cleanup);

describe("Invite to a circle on a profile", () => {
  it("is offered to a circle Admin who follows the member both ways", () => {
    renderProfile({ follow: relation(true, true), circles: ADMIN_CIRCLES });
    expect(openMenu()).toContain(en.circles.inviteToCircle.trigger);
  });

  it("isn't offered without a mutual follow or without an Admin seat", () => {
    for (const [follow, circles] of [
      [relation(true, false), ADMIN_CIRCLES],
      [relation(false, true), ADMIN_CIRCLES],
      [relation(true, true), [circle("c_club", "Puzzle Club", "Exchange")]],
    ] as const) {
      renderProfile({ follow, circles: [...circles] });
      expect(openMenu()).not.toContain(en.circles.inviteToCircle.trigger);
      cleanup();
    }
  });

  it("invites into the chosen Admin circle and says so", async () => {
    mocks.mutation.mockResolvedValue("invite_1");
    renderProfile({ follow: relation(true, true), circles: ADMIN_CIRCLES });

    openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: en.circles.inviteToCircle.trigger }),
    );
    expect(
      screen.getByRole("heading", { name: "Invite Anna to a circle" }),
    ).toBeTruthy();
    // Only the Admin circles are on offer; the first is preselected.
    expect(
      screen.getByRole("combobox", {
        name: en.circles.inviteToCircle.circleLabel,
      }).textContent,
    ).toBe("Family");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.circles.invite.send }),
      );
    });

    expect(mocks.mutation).toHaveBeenCalledWith(INVITE, {
      circleId: "c_family",
      inviteeId: ANNA,
      permission: "ViewOnly",
    });
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Invite to Family sent to Anna",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The menu item is gone: focus goes back to the ⋯ trigger.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "More actions for Anna" }),
      ),
    );
  });

  it("explains a refusal and keeps the dialog open", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "AlreadyMember", message: "x" }),
    );
    renderProfile({ follow: relation(true, true), circles: ADMIN_CIRCLES });

    openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: en.circles.inviteToCircle.trigger }),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: en.circles.invite.send }),
      );
    });

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        en.circles.inviteErrors.AlreadyMember,
      ),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderProfile({
      follow: relation(true, true),
      circles: ADMIN_CIRCLES,
      locale: "nl",
    });
    expect(openMenu("Meer acties voor Anna")).toContain(
      nl.circles.inviteToCircle.trigger,
    );
  });
});
