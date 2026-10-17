import { describe, expect, it } from "vitest";
import { NEW_MEMBER_WINDOW_MS, shouldHandOffInvite } from "./invite-landing";

const now = 1_000_000_000;
const base = {
  memberCreatedAt: now - 60_000,
  isSelf: false,
  invite: "tok",
  inviteValid: true,
  now,
};

describe("shouldHandOffInvite", () => {
  it("hands a live token from a brand-new member to the dashboard redeemer", () => {
    expect(shouldHandOffInvite(base)).toBe(true);
  });

  it("keeps existing members on the landing (window edge is exclusive)", () => {
    expect(
      shouldHandOffInvite({
        ...base,
        memberCreatedAt: now - NEW_MEMBER_WINDOW_MS,
      }),
    ).toBe(false);
    expect(
      shouldHandOffInvite({
        ...base,
        memberCreatedAt: now - NEW_MEMBER_WINDOW_MS + 1,
      }),
    ).toBe(true);
  });

  it("ignores the owner's own link, dead tokens and a missing token", () => {
    expect(shouldHandOffInvite({ ...base, isSelf: true })).toBe(false);
    expect(shouldHandOffInvite({ ...base, inviteValid: false })).toBe(false);
    expect(shouldHandOffInvite({ ...base, invite: undefined })).toBe(false);
    expect(shouldHandOffInvite({ ...base, invite: "" })).toBe(false);
  });
});
