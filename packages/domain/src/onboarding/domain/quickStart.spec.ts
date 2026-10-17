import { describe, expect, it } from "vitest";
import {
  applyQuickStartChange,
  deriveQuickStart,
  QUICK_START_STEP_IDS,
  type QuickStartFacts,
  type QuickStartInput,
  type QuickStartState,
} from "./quickStart";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 17);

const NO_FACTS: QuickStartFacts = {
  copies: 0,
  completions: 0,
  follows: 0,
  pendingFollowRequests: 0,
  inHousehold: false,
  pendingHouseholdInvite: false,
  hasLocation: false,
  visibilitySet: false,
};

const EMPTY: QuickStartState = { skippedSteps: [] };

const input = (
  over: Partial<Omit<QuickStartInput, "facts">> & {
    facts?: Partial<QuickStartFacts>;
  } = {},
): QuickStartInput => ({
  now: NOW,
  accountCreatedAt: NOW - DAY,
  state: EMPTY,
  ...over,
  facts: { ...NO_FACTS, ...over.facts },
});

const stepOf = (i: QuickStartInput, id: string) =>
  deriveQuickStart(i).steps.find((s) => s.id === id);

describe("deriveQuickStart: steps", () => {
  it("lists the five steps in order, household optional", () => {
    const { steps } = deriveQuickStart(input());
    expect(steps.map((s) => s.id)).toEqual([...QUICK_START_STEP_IDS]);
    expect(steps.map((s) => s.optional)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(steps.every((s) => s.status === "todo")).toBe(true);
  });

  it("puzzles is done at 3 copies, not at 2, and carries the count", () => {
    expect(stepOf(input({ facts: { copies: 2 } }), "puzzles")).toEqual({
      id: "puzzles",
      status: "todo",
      optional: false,
      count: 2,
    });
    expect(stepOf(input({ facts: { copies: 3 } }), "puzzles")).toEqual({
      id: "puzzles",
      status: "done",
      optional: false,
      count: 3,
    });
  });

  it("solves is done at 1 completion and carries the count", () => {
    expect(stepOf(input(), "solves")).toMatchObject({
      status: "todo",
      count: 0,
    });
    expect(stepOf(input({ facts: { completions: 1 } }), "solves")).toEqual({
      id: "solves",
      status: "done",
      optional: false,
      count: 1,
    });
  });

  it("people is done by a follow or a pending follow request; count is follows", () => {
    expect(stepOf(input(), "people")).toMatchObject({
      status: "todo",
      count: 0,
    });
    expect(stepOf(input({ facts: { follows: 2 } }), "people")).toEqual({
      id: "people",
      status: "done",
      optional: false,
      count: 2,
    });
    expect(
      stepOf(input({ facts: { pendingFollowRequests: 1 } }), "people"),
    ).toMatchObject({ status: "done", count: 0 });
  });

  it("household is done by membership and flags a pending invite", () => {
    expect(stepOf(input(), "household")).toEqual({
      id: "household",
      status: "todo",
      optional: true,
      pendingInvite: false,
    });
    expect(
      stepOf(input({ facts: { pendingHouseholdInvite: true } }), "household"),
    ).toEqual({
      id: "household",
      status: "todo",
      optional: true,
      pendingInvite: true,
    });
    expect(
      stepOf(input({ facts: { inHousehold: true } }), "household"),
    ).toMatchObject({ status: "done" });
  });

  it("profile is done by a location or an explicit visibility", () => {
    expect(stepOf(input(), "profile")).toEqual({
      id: "profile",
      status: "todo",
      optional: false,
    });
    expect(
      stepOf(input({ facts: { hasLocation: true } }), "profile"),
    ).toMatchObject({ status: "done" });
    expect(
      stepOf(input({ facts: { visibilitySet: true } }), "profile"),
    ).toMatchObject({ status: "done" });
  });

  it("marks skipped steps skipped, but done wins over skipped", () => {
    const state = { skippedSteps: ["puzzles", "solves"] as const };
    const i = input({ state: { skippedSteps: [...state.skippedSteps] } });
    expect(stepOf(i, "puzzles")?.status).toBe("skipped");
    const done = input({
      state: { skippedSteps: [...state.skippedSteps] },
      facts: { completions: 4 },
    });
    expect(stepOf(done, "solves")?.status).toBe("done");
  });

  it("counts only done required steps out of 4", () => {
    const view = deriveQuickStart(
      input({
        state: { skippedSteps: ["people"] },
        facts: {
          copies: 5,
          completions: 1,
          inHousehold: true,
          hasLocation: true,
        },
      }),
    );
    expect(view.requiredDone).toBe(3);
    expect(view.requiredTotal).toBe(4);
  });
});

describe("deriveQuickStart: eligibility and the welcome", () => {
  it("a member younger than 7 days is eligible and sees the welcome", () => {
    const view = deriveQuickStart(
      input({ accountCreatedAt: NOW - 7 * DAY + 1 }),
    );
    expect(view.eligible).toBe(true);
    expect(view.showWelcome).toBe(true);
  });

  it("a member exactly 7 days old is no longer eligible", () => {
    const view = deriveQuickStart(input({ accountCreatedAt: NOW - 7 * DAY }));
    expect(view.eligible).toBe(false);
    expect(view.showWelcome).toBe(false);
  });

  it("the welcome stops once dismissed", () => {
    const view = deriveQuickStart(
      input({ state: { skippedSteps: [], welcomeDismissedAt: NOW - 1 } }),
    );
    expect(view.eligible).toBe(true);
    expect(view.showWelcome).toBe(false);
  });
});

describe("deriveQuickStart: card visibility", () => {
  it("shows the card to a new member with open steps", () => {
    expect(deriveQuickStart(input()).cardVisible).toBe(true);
  });

  it("shows the card to a member up to 30 days old who has copies", () => {
    const i = input({
      accountCreatedAt: NOW - 30 * DAY + 1,
      facts: { copies: 1 },
    });
    expect(deriveQuickStart(i).cardVisible).toBe(true);
  });

  it("hides the card from a 30-day-old member with copies", () => {
    const i = input({ accountCreatedAt: NOW - 30 * DAY, facts: { copies: 1 } });
    expect(deriveQuickStart(i).cardVisible).toBe(false);
  });

  it("shows the card (but not the welcome) to an old member with 0 copies", () => {
    const view = deriveQuickStart(input({ accountCreatedAt: NOW - 400 * DAY }));
    expect(view.cardVisible).toBe(true);
    expect(view.showWelcome).toBe(false);
    expect(view.eligible).toBe(false);
  });

  it("hides the card once dismissed", () => {
    const i = input({ state: { skippedSteps: [], cardDismissedAt: NOW - 1 } });
    expect(deriveQuickStart(i).cardVisible).toBe(false);
  });

  it("hides the card when every required step is done or skipped, household aside", () => {
    const i = input({
      state: { skippedSteps: ["people", "profile"] },
      facts: { copies: 3, completions: 1 },
    });
    expect(deriveQuickStart(i).cardVisible).toBe(false);
  });

  it("keeps the card while one required step is open", () => {
    const i = input({
      state: { skippedSteps: ["people", "household"] },
      facts: { copies: 3, completions: 1 },
    });
    expect(deriveQuickStart(i).cardVisible).toBe(true);
  });
});

describe("applyQuickStartChange", () => {
  it("skips a step once, keeping step order", () => {
    const once = applyQuickStartChange(
      { skippedSteps: ["profile"] },
      { kind: "skipStep", step: "puzzles" },
      NOW,
    );
    expect(once).toEqual({ skippedSteps: ["puzzles", "profile"] });
    expect(
      applyQuickStartChange(once!, { kind: "skipStep", step: "puzzles" }, NOW),
    ).toBeNull();
  });

  it("unskips a skipped step and is a no-op otherwise", () => {
    expect(
      applyQuickStartChange(
        { skippedSteps: ["puzzles", "solves"] },
        { kind: "unskipStep", step: "puzzles" },
        NOW,
      ),
    ).toEqual({ skippedSteps: ["solves"] });
    expect(
      applyQuickStartChange(
        EMPTY,
        { kind: "unskipStep", step: "puzzles" },
        NOW,
      ),
    ).toBeNull();
  });

  it("dismisses the welcome once, keeping the first timestamp", () => {
    const once = applyQuickStartChange(EMPTY, { kind: "dismissWelcome" }, NOW);
    expect(once).toEqual({ skippedSteps: [], welcomeDismissedAt: NOW });
    expect(
      applyQuickStartChange(once!, { kind: "dismissWelcome" }, NOW + 5),
    ).toBeNull();
  });

  it("records the first start of the flow once, keeping the first timestamp", () => {
    const once = applyQuickStartChange(
      { skippedSteps: ["solves"] },
      { kind: "startQuickStart" },
      NOW,
    );
    expect(once).toEqual({ skippedSteps: ["solves"], startedAt: NOW });
    expect(
      applyQuickStartChange(once!, { kind: "startQuickStart" }, NOW + 5),
    ).toBeNull();
  });

  it("dismisses the card once and restores it", () => {
    const dismissed = applyQuickStartChange(
      { skippedSteps: ["solves"], welcomeDismissedAt: 1 },
      { kind: "dismissCard" },
      NOW,
    );
    expect(dismissed).toEqual({
      skippedSteps: ["solves"],
      welcomeDismissedAt: 1,
      cardDismissedAt: NOW,
    });
    expect(
      applyQuickStartChange(dismissed!, { kind: "dismissCard" }, NOW + 5),
    ).toBeNull();
    expect(
      applyQuickStartChange(dismissed!, { kind: "restoreCard" }, NOW + 5),
    ).toEqual({ skippedSteps: ["solves"], welcomeDismissedAt: 1 });
    expect(
      applyQuickStartChange(EMPTY, { kind: "restoreCard" }, NOW),
    ).toBeNull();
  });
});
