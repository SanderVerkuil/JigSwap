import { describe, expect, it } from "vitest";
import { lockedProfileFromTeaser } from "./teaser-profile";

describe("lockedProfileFromTeaser", () => {
  it("renders the teaser's identity as a locked profile with nothing more", () => {
    const profile = lockedProfileFromTeaser({
      memberId: "u_bob",
      displayName: "Bobby",
      username: "bob",
      slug: "bobby",
      avatar: "https://example.com/a.png",
      memberSince: 5,
      visibility: "private",
      puzzleCount: null,
    });
    expect(profile).toEqual({
      locked: true,
      hero: {
        memberId: "u_bob",
        displayName: "Bobby",
        username: "bob",
        slug: "bobby",
        avatar: "https://example.com/a.png",
        memberSince: 5,
        rating: 0,
        reviewCount: 0,
        followerCount: 0,
        followingCount: 0,
        visibility: "private",
      },
    });
    // Never flagged as the viewer's own block, and no location.
    expect(profile).not.toHaveProperty("blockedByMe");
    expect(profile.hero).not.toHaveProperty("location");
  });
});
