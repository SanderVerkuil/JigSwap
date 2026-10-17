import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  canWebShare,
  inviteLandingUrl,
  inviteLinkErrorKey,
  mailtoUrl,
  whatsAppUrl,
} from "./invite-share";

describe("inviteLandingUrl", () => {
  it("points at the member-id landing with the token", () => {
    expect(inviteLandingUrl("https://jigswap.app", "abc123", "f00d")).toBe(
      "https://jigswap.app/members/abc123?invite=f00d",
    );
  });

  it("encodes both path and query parts", () => {
    expect(inviteLandingUrl("https://x.test", "a/b", "t&u")).toBe(
      "https://x.test/members/a%2Fb?invite=t%26u",
    );
  });
});

describe("mailtoUrl", () => {
  it("leaves the recipient empty and encodes subject and body", () => {
    const url = mailtoUrl({
      subject: "Kom ook op JigSwap",
      body: "Word lid van ons huishouden: https://x.test/members/a?invite=t&x=1",
    });
    expect(url.startsWith("mailto:?subject=")).toBe(true);
    expect(url).toBe(
      "mailto:?subject=Kom%20ook%20op%20JigSwap&body=Word%20lid%20van%20ons%20huishouden%3A%20https%3A%2F%2Fx.test%2Fmembers%2Fa%3Finvite%3Dt%26x%3D1",
    );
  });

  it("round-trips non-ASCII text", () => {
    const url = new URL(mailtoUrl({ subject: "één", body: "plank ✓" }));
    expect(url.pathname).toBe("");
    expect(url.searchParams.get("subject")).toBe("één");
    expect(url.searchParams.get("body")).toBe("plank ✓");
  });
});

describe("whatsAppUrl", () => {
  it("uses click-to-chat with no phone number", () => {
    const url = new URL(whatsAppUrl("Join me: https://x.test/m?invite=t&a=b"));
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("text")).toBe(
      "Join me: https://x.test/m?invite=t&a=b",
    );
  });
});

describe("canWebShare", () => {
  it("is false on the server and without navigator.share", () => {
    expect(canWebShare(undefined)).toBe(false);
    expect(canWebShare({} as Pick<Navigator, "share">)).toBe(false);
  });

  it("is true when navigator.share is a function", () => {
    expect(canWebShare({ share: async () => {} })).toBe(true);
  });
});

describe("inviteLinkErrorKey", () => {
  it("maps the rate limit to its own message", () => {
    expect(
      inviteLinkErrorKey(new ConvexError({ code: "invite_rate_limited" })),
    ).toBe("rateLimited");
  });

  it("falls back to a generic message", () => {
    expect(
      inviteLinkErrorKey(new ConvexError({ code: "NotHouseholdAdmin" })),
    ).toBe("createFailed");
    expect(inviteLinkErrorKey(new Error("network"))).toBe("createFailed");
  });
});
