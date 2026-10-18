import { ConvexError } from "convex/values";
import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  circleInviteErrorKey,
  INVITE_UNAVAILABLE_KEY,
} from "./circle-invite-error";

const fail = (code: string) => new ConvexError({ code, message: "x" });

describe("circleInviteErrorKey", () => {
  it("maps each invite refusal code to its own message key", () => {
    for (const code of [
      "CannotInvite",
      "AlreadyMember",
      "CircleFull",
      "NotCircleAdmin",
      "CircleNotFound",
      "RateLimited",
    ]) {
      expect(circleInviteErrorKey(fail(code))).toBe(`inviteErrors.${code}`);
    }
  });

  it("reads every no-longer-pending code as the neutral unavailable key", () => {
    for (const code of [
      "InviteNotFound",
      "InviteExpired",
      "InviteNotPending",
    ]) {
      expect(circleInviteErrorKey(fail(code))).toBe(INVITE_UNAVAILABLE_KEY);
    }
  });

  it("falls back to the generic key for unknown codes and non-Convex errors", () => {
    expect(circleInviteErrorKey(fail("Weird"))).toBe("inviteErrors.generic");
    expect(circleInviteErrorKey(new ConvexError("plain"))).toBe(
      "inviteErrors.generic",
    );
    expect(circleInviteErrorKey(new Error("boom"))).toBe(
      "inviteErrors.generic",
    );
  });

  it("has a message for every key it can return, in en and nl", () => {
    const keys = [
      INVITE_UNAVAILABLE_KEY,
      "inviteErrors.generic",
      ...[
        "CannotInvite",
        "AlreadyMember",
        "CircleFull",
        "NotCircleAdmin",
        "CircleNotFound",
        "RateLimited",
      ].map((code) => `inviteErrors.${code}`),
    ];
    for (const [locale, messages] of [
      ["en", en],
      ["nl", nl],
    ] as const) {
      const t = createTranslator({ locale, messages, namespace: "circles" });
      for (const key of keys) {
        expect(t.has(key as never)).toBe(true);
      }
    }
    expect(
      createTranslator({ locale: "nl", messages: nl, namespace: "circles" })(
        INVITE_UNAVAILABLE_KEY,
      ),
    ).toBe("Deze uitnodiging is niet meer beschikbaar.");
  });
});
