// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { MouseEvent, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ProfileBody, type PublicProfileView } from "./profile-body";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(params: unknown) => void>(),
}));

// A router-free Link that records where a click would navigate to. It keeps the
// caller's onClick so the dialog's own close-on-click behaviour runs.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    onClick,
    className,
  }: {
    children?: ReactNode;
    params?: unknown;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
  }) => (
    <a
      href="#"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
        mocks.navigate(params);
      }}
    >
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

// Followers-you-know per profile; every other query stays unresolved.
const knownFollowers: Record<string, unknown> = {
  member_anna: {
    total: 1,
    members: [{ memberId: "member_bert", displayName: "Bert", slug: "bert" }],
  },
  member_bert: {
    total: 1,
    members: [{ memberId: "member_cleo", displayName: "Cleo", slug: "cleo" }],
  },
};
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => {
    const [, name, args] = options.queryKey as [
      string,
      string,
      { memberId?: string },
    ];
    return {
      data:
        name.includes("followersYouKnow") && args.memberId
          ? knownFollowers[args.memberId]
          : undefined,
    };
  },
}));

// Out of scope here: the hero actions and the paginated listings.
vi.mock("@/components/social/follow-button", () => ({
  FollowButton: () => null,
}));
vi.mock("@/components/social/message-button", () => ({
  MessageButton: () => null,
}));
vi.mock("@/components/social/member-actions-menu", () => ({
  MemberActionsMenu: () => null,
}));
vi.mock("@/components/members/profile-listings", () => ({
  ProfileCompletionsSection: () => null,
  ProfilePuzzlesSection: () => null,
}));

const profileOf = (memberId: string, displayName: string) =>
  ({
    locked: false,
    hero: {
      memberId,
      displayName,
      slug: displayName.toLowerCase(),
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
  }) as unknown as PublicProfileView;

const withIntl = (node: ReactNode) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {node}
  </IntlProvider>
);

afterEach(() => {
  cleanup();
  mocks.navigate.mockReset();
});

describe("ProfileBody followers-you-know dialog", () => {
  it("closes when a member is clicked and navigates to their profile", async () => {
    render(
      withIntl(
        <ProfileBody
          profile={profileOf("member_anna", "Anna")}
          viewer="member"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Followed by Bert/ }));
    const dialog = screen.getByRole("dialog", { name: "Followers you know" });
    fireEvent.click(within(dialog).getByText("Bert"));

    expect(mocks.navigate).toHaveBeenCalledWith({ handle: "bert" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not carry an open dialog over to the next profile", async () => {
    const { rerender } = render(
      withIntl(
        <ProfileBody
          profile={profileOf("member_anna", "Anna")}
          viewer="member"
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Followed by Bert/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Same route, new $handle (or Back/Forward): the body re-renders with another profile.
    rerender(
      withIntl(
        <ProfileBody
          profile={profileOf("member_bert", "Bert")}
          viewer="member"
        />,
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Reopening shows the new profile's list.
    fireEvent.click(screen.getByRole("button", { name: /Followed by Cleo/ }));
    const dialog = screen.getByRole("dialog", { name: "Followers you know" });
    expect(within(dialog).getByText("Cleo")).toBeTruthy();
    expect(within(dialog).queryByText("Bert")).toBeNull();
  });
});
