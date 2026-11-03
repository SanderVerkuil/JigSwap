import { describe, expect, it } from "vitest";
import {
  inviteHrefTarget,
  NEW_MEMBER_WINDOW_MS,
  shouldHandOffInvite,
} from "./invite-landing";

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

describe("inviteHrefTarget", () => {
  it("reads the member and token from a member page's invite link", () => {
    expect(inviteHrefTarget("/members/hans?invite=abc")).toEqual({
      handle: "hans",
      token: "abc",
    });
  });

  it("takes the full URL Clerk may hand back, and decodes the handle", () => {
    expect(
      inviteHrefTarget("https://jigswap.site/members/h%C3%A9t/?invite=a%2Fb"),
    ).toEqual({ handle: "hét", token: "a/b" });
  });

  it("is null for anything else", () => {
    for (const href of [
      undefined,
      null,
      42,
      "",
      "/dashboard",
      "/members/hans",
      "/members/hans?invite=",
      "/members/hans/shelf?invite=abc",
      "/copies/abc?shared=1",
      "http://[bad",
      "/members/%E0%A4%A?invite=abc",
    ]) {
      expect(inviteHrefTarget(href)).toBeNull();
    }
  });
});
