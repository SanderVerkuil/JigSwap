// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ProfileBody, type PublicProfileView } from "./profile-body";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));

// The blocked stub keeps the body to the hero, so only the @handle line is under test.
const profileWith = (hero: { handle?: string; slug?: string }) =>
  ({
    locked: true,
    blockedByMe: true,
    hero: {
      memberId: "member_hans",
      displayName: "Hans",
      username: "hans",
      memberSince: Date.UTC(2024, 0, 1),
      visibility: "private",
      followerCount: 0,
      followingCount: 0,
      reviewCount: 0,
      rating: 0,
      ...hero,
    },
  }) as unknown as PublicProfileView;

const renderHero = (profile: PublicProfileView, requestedHandle?: string) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <ProfileBody
        profile={profile}
        viewer="member"
        requestedHandle={requestedHandle}
      />
    </IntlProvider>,
  );

const handleLine = () =>
  document.querySelector("section [data-slot=member-handle]")?.textContent ??
  null;

afterEach(cleanup);

describe("ProfileBody hero @handle (SEC-07)", () => {
  it("shows the server's canonical handle", () => {
    renderHero(profileWith({ handle: "hansje" }), "hansje");
    expect(handleLine()).toBe("hansje");
  });

  it("hides the line when the canonical handle is the bare id", () => {
    renderHero(profileWith({ handle: "member_hans" }), "member_hans");
    expect(handleLine()).toBeNull();
  });

  describe("a backend that predates `handle` (deploy skew)", () => {
    it("shows the handle the page was opened with, which resolved to this member", () => {
      renderHero(profileWith({}), "hans");
      expect(handleLine()).toBe("hans");
    });

    it("prefers the slug", () => {
      renderHero(profileWith({ slug: "hansje" }), "hans");
      expect(handleLine()).toBe("hansje");
    });

    it("never rebuilds it from the username", () => {
      renderHero(profileWith({}), "member_hans");
      expect(handleLine()).toBeNull();
      cleanup();
      renderHero(profileWith({}));
      expect(handleLine()).toBeNull();
    });
  });
});
