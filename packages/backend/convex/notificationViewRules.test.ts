import { describe, expect, test } from "vitest";
import {
  decideFollowBack,
  decideFollowRequest,
  decideHouseholdInvite,
  decideMessage,
  isActorRevealed,
  legacyNotificationHref,
  messagePreviewOf,
  notificationHref,
  withoutActionsWhenGrouped,
  type ActorFacts,
  type HrefInput,
} from "./notifications/viewRules";

// Pure decision rules of the notification read model (no database).

const hidden: ActorFacts = {
  active: true,
  isViewer: false,
  isPublic: false,
  mutualFollowers: false,
};

describe("isActorRevealed", () => {
  test("a deleted or deactivated actor is never revealed, even to themself", () => {
    expect(
      isActorRevealed(
        "new_follower",
        { ...hidden, active: false, isViewer: true, isPublic: true },
        true,
      ),
    ).toBe(false);
  });

  test("the viewer always sees themself", () => {
    expect(
      isActorRevealed("goal_achieved", { ...hidden, isViewer: true }, false),
    ).toBe(true);
  });

  test.each([
    "new_follower",
    "follow_request_received",
    "follow_request_approved",
    "household_invite_received",
    "household_invite_accepted",
    "message_received",
    "review_received",
  ] as const)("%s: a private, non-mutual initiator is revealed", (type) => {
    expect(isActorRevealed(type, hidden, false)).toBe(true);
  });

  // Trade types resolve their actor per trade (exchange/tradeParty); without a resolvable exchange
  // only the ordinary public / mutual rule applies — they are never pair-wide initiator reveals.
  test.each([
    "trade_request",
    "trade_accepted",
    "trade_declined",
    "trade_completed",
    "trade_cancelled",
    "exchange_disputed",
  ] as const)("%s: falls back to public / mutual only", (type) => {
    expect(isActorRevealed(type, hidden, false)).toBe(false);
    expect(isActorRevealed(type, { ...hidden, isPublic: true }, false)).toBe(
      true,
    );
  });

  test("a private, non-mutual actor on a non-initiator type is hidden", () => {
    expect(isActorRevealed("goal_achieved", hidden, false)).toBe(false);
    expect(isActorRevealed("puzzle_approved", hidden, true)).toBe(false);
  });

  test("a public or mutual actor on a non-initiator type is revealed", () => {
    expect(
      isActorRevealed("goal_achieved", { ...hidden, isPublic: true }, false),
    ).toBe(true);
    expect(
      isActorRevealed(
        "goal_achieved",
        { ...hidden, mutualFollowers: true },
        false,
      ),
    ).toBe(true);
  });

  test("admin types reveal the submitter to an admin only", () => {
    expect(isActorRevealed("admin_proposal_filed", hidden, true)).toBe(true);
    expect(isActorRevealed("admin_definition_submitted", hidden, true)).toBe(
      true,
    );
    expect(isActorRevealed("admin_proposal_filed", hidden, false)).toBe(false);
  });
});

describe("decideFollowBack", () => {
  const facts = {
    actorFollowsViewer: true,
    viewerFollowsActor: false,
    viewerRequestPending: false,
  };

  test("new_follower: offers follow back while the follower still follows the viewer", () => {
    expect(decideFollowBack("new_follower", facts)).toEqual({
      state: "actionable",
      availableActions: ["follow_back"],
    });
  });

  test("already following each other / following / requested resolve", () => {
    expect(
      decideFollowBack("new_follower", { ...facts, viewerFollowsActor: true }),
    ).toEqual({
      state: "resolved",
      resolvedAs: "following_each_other",
      availableActions: [],
    });
    expect(
      decideFollowBack("follow_request_approved", {
        ...facts,
        actorFollowsViewer: false,
        viewerFollowsActor: true,
      }),
    ).toEqual({
      state: "resolved",
      resolvedAs: "following",
      availableActions: [],
    });
    expect(
      decideFollowBack("new_follower", {
        ...facts,
        viewerRequestPending: true,
      }),
    ).toEqual({
      state: "resolved",
      resolvedAs: "requested",
      availableActions: [],
    });
  });

  test("new_follower: nothing to do once the follower left", () => {
    expect(
      decideFollowBack("new_follower", { ...facts, actorFollowsViewer: false }),
    ).toEqual({ state: "informational", availableActions: [] });
  });

  test("follow_request_approved: follow back toward the approver regardless of their edge", () => {
    expect(
      decideFollowBack("follow_request_approved", {
        ...facts,
        actorFollowsViewer: false,
      }),
    ).toEqual({ state: "actionable", availableActions: ["follow_back"] });
  });
});

describe("decideFollowRequest", () => {
  test("pending offers approve, approve & follow back and decline", () => {
    expect(
      decideFollowRequest({ status: "pending", viewerFollowsRequester: false }),
    ).toEqual({
      state: "actionable",
      availableActions: [
        "approve_follow_request",
        "approve_and_follow_back",
        "decline_follow_request",
      ],
    });
  });

  test("pending without approve & follow back when the viewer already follows the requester", () => {
    expect(
      decideFollowRequest({ status: "pending", viewerFollowsRequester: true })
        .availableActions,
    ).toEqual(["approve_follow_request", "decline_follow_request"]);
  });

  test.each([
    ["approved", "approved"],
    ["declined", "declined"],
    [null, "expired"],
  ] as const)("%s resolves as %s", (status, resolvedAs) => {
    expect(
      decideFollowRequest({ status, viewerFollowsRequester: false }),
    ).toEqual({ state: "resolved", resolvedAs, availableActions: [] });
  });
});

describe("decideHouseholdInvite", () => {
  test("pending offers accept and decline", () => {
    expect(decideHouseholdInvite("pending")).toEqual({
      state: "actionable",
      availableActions: ["accept_household_invite", "decline_household_invite"],
    });
  });

  test.each([
    ["accepted", "joined"],
    ["declined", "declined"],
    [null, "expired"],
  ] as const)("%s resolves as %s", (status, resolvedAs) => {
    expect(decideHouseholdInvite(status)).toEqual({
      state: "resolved",
      resolvedAs,
      availableActions: [],
    });
  });
});

describe("decideMessage / grouping", () => {
  test("reply only while still a participant", () => {
    expect(decideMessage(true)).toEqual({
      state: "actionable",
      availableActions: ["reply_message"],
    });
    expect(decideMessage(false)).toEqual({
      state: "unavailable",
      availableActions: [],
    });
  });

  test("grouped rows drop their actions; non-actionable decisions pass through", () => {
    const followBack = decideFollowBack("new_follower", {
      actorFollowsViewer: true,
      viewerFollowsActor: false,
      viewerRequestPending: false,
    });
    expect(withoutActionsWhenGrouped(followBack, 1)).toBe(followBack);
    expect(withoutActionsWhenGrouped(followBack, 2)).toEqual({
      state: "informational",
      availableActions: [],
    });
    const done = decideHouseholdInvite("accepted");
    expect(withoutActionsWhenGrouped(done, 3)).toBe(done);
  });
});

describe("notificationHref", () => {
  const base: HrefInput = {
    type: "trade_request",
    hasRefs: true,
    actorHandle: "mara",
    actorCount: 1,
    subjectAvailable: true,
  };

  test("trades deep-link to the exchange; unavailable or subject-less to the list", () => {
    const subject = { kind: "exchange", exchangeId: "ex 1" } as const;
    expect(notificationHref({ ...base, subject })).toBe(
      "/trades?exchange=ex%201",
    );
    expect(
      notificationHref({ ...base, subject, subjectAvailable: false }),
    ).toBe("/trades");
    expect(notificationHref({ ...base, type: "exchange_disputed" })).toBe(
      "/trades",
    );
  });

  test("follow types link to the actor; anonymous to nothing; grouped to /people", () => {
    expect(notificationHref({ ...base, type: "new_follower" })).toBe(
      "/members/mara",
    );
    expect(notificationHref({ ...base, type: "follow_request_received" })).toBe(
      "/members/mara",
    );
    expect(
      notificationHref({
        ...base,
        type: "follow_request_approved",
        actorHandle: null,
      }),
    ).toBeNull();
    expect(
      notificationHref({ ...base, type: "new_follower", actorCount: 4 }),
    ).toBe("/people");
  });

  test("message, puzzle, copy, proposal and what's-new subjects", () => {
    expect(
      notificationHref({
        ...base,
        type: "message_received",
        subject: { kind: "thread", threadId: "t1" },
      }),
    ).toBe("/messages/t1");
    expect(
      notificationHref({
        ...base,
        type: "message_received",
        subject: { kind: "thread", threadId: "t1" },
        subjectAvailable: false,
      }),
    ).toBe("/messages");
    const puzzle = { kind: "puzzle", puzzleId: "p1" } as const;
    expect(
      notificationHref({ ...base, type: "puzzle_approved", subject: puzzle }),
    ).toBe("/puzzles/p1");
    expect(
      notificationHref({
        ...base,
        type: "proposal_rejected",
        subject: puzzle,
        subjectAvailable: false,
      }),
    ).toBe("/puzzles");
    expect(
      notificationHref({
        ...base,
        type: "photo_removed",
        subject: { kind: "copy", copyId: "c1" },
      }),
    ).toBe("/my-puzzles/c1");
    expect(
      notificationHref({
        ...base,
        type: "photo_removed",
        subject: { kind: "copy", copyId: "c1" },
        subjectAvailable: false,
      }),
    ).toBe("/my-puzzles");
    expect(
      notificationHref({
        ...base,
        type: "admin_proposal_filed",
        subject: { kind: "changeProposal", proposalId: "cp1" },
      }),
    ).toBe("/admin/puzzles/proposals/cp1");
    expect(
      notificationHref({
        ...base,
        type: "whats_new",
        subject: { kind: "whatsNew", entryId: "2026-10-tours" },
      }),
    ).toBe("/whats-new#entry-2026-10-tours");
  });

  test("static targets", () => {
    expect(notificationHref({ ...base, type: "goal_achieved" })).toBe("/goals");
    expect(notificationHref({ ...base, type: "review_received" })).toBe(
      "/profile",
    );
    expect(notificationHref({ ...base, type: "puzzle_rejected" })).toBe(
      "/puzzles",
    );
    expect(
      notificationHref({ ...base, type: "admin_definition_submitted" }),
    ).toBe("/admin/moderation");
    expect(
      notificationHref({ ...base, type: "household_invite_received" }),
    ).toBe("/household");
  });

  test("a legacy row (no refs) keeps its relatedId-based link", () => {
    expect(
      notificationHref({
        ...base,
        type: "new_follower",
        hasRefs: false,
        relatedId: "u1",
      }),
    ).toBe("/people");
    expect(
      notificationHref({
        ...base,
        type: "message_received",
        hasRefs: false,
        relatedId: "t9",
      }),
    ).toBe("/messages/t9");
  });
});

describe("legacyNotificationHref (mirror of the web's notificationHref)", () => {
  test.each([
    ["trade_request", "x", "/trades"],
    ["exchange_proposed", "x", "/trades"],
    ["message_received", undefined, "/messages"],
    ["review_received", "x", "/profile"],
    ["goal_achieved", "x", "/goals"],
    ["puzzle_favorited", "p", "/puzzles/p"],
    ["puzzle_approved", undefined, "/puzzles"],
    ["puzzle_rejected", "p", "/puzzles"],
    ["photo_removed", "c", "/my-puzzles/c"],
    ["photo_removed", undefined, "/my-puzzles"],
    ["proposal_approved", "p", "/puzzles/p"],
    ["proposal_rejected", undefined, "/puzzles"],
    ["admin_proposal_filed", "cp", "/admin/puzzles/proposals/cp"],
    ["admin_proposal_filed", undefined, "/admin/puzzles/proposals"],
    ["admin_definition_submitted", "p", "/admin/moderation"],
    ["follow_request_received", "u", "/people"],
    ["follow_request_approved", "u", "/people"],
    ["household_invite_accepted", "h", "/household"],
    ["whats_new", "e1", "/whats-new#entry-e1"],
    ["whats_new", undefined, "/whats-new"],
  ] as const)("%s (%s) -> %s", (type, relatedId, href) => {
    expect(legacyNotificationHref(type, relatedId)).toBe(href);
  });
});

describe("messagePreviewOf", () => {
  test("collapses whitespace and keeps short bodies whole", () => {
    expect(messagePreviewOf("  hello \n  there ")).toBe("hello there");
    expect(messagePreviewOf("   ")).toBeUndefined();
  });

  test("cuts long bodies to 80 characters with an ellipsis", () => {
    const preview = messagePreviewOf("a".repeat(200));
    expect(preview).toHaveLength(80);
    expect(preview?.endsWith("…")).toBe(true);
    expect(messagePreviewOf("b".repeat(80))).toBe("b".repeat(80));
  });
});
