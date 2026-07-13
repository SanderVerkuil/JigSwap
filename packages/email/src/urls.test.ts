import { describe, expect, it } from "vitest";
import { EMAIL_TYPES, type EmailType } from "./copy";
import { ctaPath } from "./urls";

const EXPECTED: Record<EmailType, string> = {
  trade_request: "/trades",
  trade_accepted: "/trades",
  trade_declined: "/trades",
  trade_completed: "/trades",
  trade_cancelled: "/trades",
  message_received: "/messages",
  review_received: "/profile",
  puzzle_favorited: "/puzzles",
  goal_achieved: "/goals",
  new_follower: "/people",
  follow_request_received: "/people",
  follow_request_approved: "/people",
};

const EXPECTED_WITH_RELATED_ID: Record<EmailType, string> = {
  ...EXPECTED,
  message_received: "/messages/rel-1",
  puzzle_favorited: "/puzzles/rel-1",
};

describe("ctaPath", () => {
  it.each(EMAIL_TYPES)("returns %s without a relatedId", (type) => {
    expect(ctaPath(type)).toBe(EXPECTED[type]);
  });

  it.each(EMAIL_TYPES)("returns %s with a relatedId", (type) => {
    expect(ctaPath(type, "rel-1")).toBe(EXPECTED_WITH_RELATED_ID[type]);
  });
});
