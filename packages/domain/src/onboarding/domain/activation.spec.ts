import { describe, expect, it } from "vitest";
import {
  ACTIVATION_REPORT_MAX_RANGE_MS,
  evaluateActivation,
  isActivated,
  isValidActivationRange,
  summarizeActivation,
  type ActivationFacts,
  type ActivationReportMember,
} from "./activation";

const DAY = 24 * 60 * 60 * 1000;
const SIGNUP = Date.UTC(2026, 9, 1);
const END = SIGNUP + 7 * DAY; // the last instant inside the 7-day window

const NONE: ActivationFacts = {
  copyCreatedAts: [],
  completionCreatedAts: [],
  mutualConnectedAts: [],
};
const facts = (over: Partial<ActivationFacts> = {}): ActivationFacts => ({
  ...NONE,
  ...over,
});
const threeCopies = [SIGNUP, SIGNUP + DAY, SIGNUP + 2 * DAY];

describe("evaluateActivation: copies", () => {
  it("needs 3 copies inside the window; 2 are not enough", () => {
    expect(
      evaluateActivation(facts({ copyCreatedAts: threeCopies }), SIGNUP)
        .copies3,
    ).toBe(true);
    expect(
      evaluateActivation(
        facts({ copyCreatedAts: threeCopies.slice(0, 2) }),
        SIGNUP,
      ).copies3,
    ).toBe(false);
  });

  it("counts a copy at sign-up and one at exactly day 7, not one a millisecond later", () => {
    expect(
      evaluateActivation(
        facts({ copyCreatedAts: [SIGNUP, SIGNUP + DAY, END] }),
        SIGNUP,
      ).copies3,
    ).toBe(true);
    expect(
      evaluateActivation(
        facts({ copyCreatedAts: [SIGNUP, SIGNUP + DAY, END + 1] }),
        SIGNUP,
      ).copies3,
    ).toBe(false);
  });

  it("does not count a row dated before sign-up", () => {
    expect(
      evaluateActivation(
        facts({ copyCreatedAts: [SIGNUP - 1, SIGNUP, SIGNUP + 1] }),
        SIGNUP,
      ).copies3,
    ).toBe(false);
  });

  it("copies alone do not activate", () => {
    expect(isActivated(facts({ copyCreatedAts: threeCopies }), SIGNUP)).toBe(
      false,
    );
  });
});

describe("evaluateActivation: the second criterion", () => {
  it("a completion inside the window activates; one after day 7 does not", () => {
    const at = (t: number) =>
      evaluateActivation(
        facts({ copyCreatedAts: threeCopies, completionCreatedAts: [t] }),
        SIGNUP,
      );
    expect(at(END)).toMatchObject({ completion: true, activated: true });
    expect(at(END + 1)).toMatchObject({ completion: false, activated: false });
    expect(at(SIGNUP - 1).completion).toBe(false);
  });

  it("a mutual connection inside the window activates; one completed after day 7 does not", () => {
    const at = (t: number) =>
      evaluateActivation(
        facts({ copyCreatedAts: threeCopies, mutualConnectedAts: [t] }),
        SIGNUP,
      );
    expect(at(END)).toMatchObject({ mutual: true, activated: true });
    expect(at(END + 1)).toMatchObject({ mutual: false, activated: false });
    expect(at(SIGNUP - 1).mutual).toBe(false);
  });

  it("household (decision 10): joined inside the window and another member, whenever they joined", () => {
    const at = (joinedAt: number, hasOtherMember: boolean) =>
      evaluateActivation(
        facts({
          copyCreatedAts: threeCopies,
          household: { joinedAt, hasOtherMember },
        }),
        SIGNUP,
      );
    expect(at(END, true)).toMatchObject({ household: true, activated: true });
    // A household of one is not a connection.
    expect(at(SIGNUP + DAY, false)).toMatchObject({
      household: false,
      activated: false,
    });
    // Joined (or created) after day 7: no credit.
    expect(at(END + 1, true).household).toBe(false);
    expect(at(SIGNUP - 1, true).household).toBe(false);
  });

  it("no household row is no household link", () => {
    expect(
      evaluateActivation(facts({ copyCreatedAts: threeCopies }), SIGNUP)
        .household,
    ).toBe(false);
  });

  it("any second criterion without 3 copies does not activate", () => {
    const result = evaluateActivation(
      facts({
        copyCreatedAts: threeCopies.slice(0, 2),
        completionCreatedAts: [SIGNUP],
        mutualConnectedAts: [SIGNUP],
        household: { joinedAt: SIGNUP, hasOtherMember: true },
      }),
      SIGNUP,
    );
    expect(result).toMatchObject({
      copies3: false,
      completion: true,
      mutual: true,
      household: true,
      activated: false,
    });
  });
});

describe("evaluateActivation: engaged (secondary signal)", () => {
  it("is a completion within 14 days, independent of activation", () => {
    const at = (t: number) =>
      evaluateActivation(facts({ completionCreatedAts: [t] }), SIGNUP)
        .completion14d;
    expect(at(SIGNUP + 14 * DAY)).toBe(true);
    expect(at(SIGNUP + 14 * DAY + 1)).toBe(false);
    expect(at(SIGNUP - 1)).toBe(false);
    expect(
      evaluateActivation(
        facts({ completionCreatedAts: [SIGNUP + 10 * DAY] }),
        SIGNUP,
      ),
    ).toMatchObject({ completion: false, completion14d: true });
  });
});

describe("isValidActivationRange", () => {
  it("accepts a non-empty range of at most 31 days", () => {
    expect(isValidActivationRange(SIGNUP, SIGNUP + 1)).toBe(true);
    expect(
      isValidActivationRange(SIGNUP, SIGNUP + ACTIVATION_REPORT_MAX_RANGE_MS),
    ).toBe(true);
    expect(ACTIVATION_REPORT_MAX_RANGE_MS).toBe(31 * DAY);
  });

  it("refuses an empty, reversed or too long range", () => {
    expect(isValidActivationRange(SIGNUP, SIGNUP)).toBe(false);
    expect(isValidActivationRange(SIGNUP, SIGNUP - 1)).toBe(false);
    expect(
      isValidActivationRange(
        SIGNUP,
        SIGNUP + ACTIVATION_REPORT_MAX_RANGE_MS + 1,
      ),
    ).toBe(false);
  });
});

const member = (
  signupAt: number,
  over: Partial<ActivationReportMember> = {},
): ActivationReportMember => ({
  signupAt,
  activation: NONE,
  welcomeAnswered: false,
  startedQuickStart: false,
  householdLinkCreated: false,
  steps: [],
  ...over,
});

describe("summarizeActivation", () => {
  const from = SIGNUP;
  const to = SIGNUP + 14 * DAY;
  const now = SIGNUP + 30 * DAY;

  it("buckets members into weekly sign-up cohorts from `from`, and a total", () => {
    const report = summarizeActivation(
      [
        member(SIGNUP),
        member(SIGNUP + 7 * DAY - 1),
        member(SIGNUP + 7 * DAY),
        member(to - 1),
      ],
      { from, to, now },
    );
    expect(report.from).toBe(from);
    expect(report.to).toBe(to);
    expect(report.generatedAt).toBe(now);
    expect(report.cohorts.map((c) => [c.from, c.to, c.signedUp])).toEqual([
      [SIGNUP, SIGNUP + 7 * DAY, 2],
      [SIGNUP + 7 * DAY, to, 2],
    ]);
    expect(report.total).toMatchObject({ from, to, signedUp: 4 });
  });

  it("cuts the last cohort at `to` and drops members outside the range", () => {
    const report = summarizeActivation(
      [member(from - 1), member(from + 8 * DAY), member(from + 9 * DAY)],
      { from, to: from + 9 * DAY, now },
    );
    expect(report.cohorts.map((c) => [c.from, c.to, c.signedUp])).toEqual([
      [from, from + 7 * DAY, 0],
      [from + 7 * DAY, from + 9 * DAY, 1],
    ]);
    expect(report.total.signedUp).toBe(1);
  });

  it("counts each criterion, activation, the rate and the funnel", () => {
    const activated: ActivationFacts = facts({
      copyCreatedAts: threeCopies,
      mutualConnectedAts: [SIGNUP + DAY],
    });
    const report = summarizeActivation(
      [
        member(SIGNUP, {
          activation: activated,
          welcomeAnswered: true,
          startedQuickStart: true,
          householdLinkCreated: true,
          steps: [
            { id: "puzzles", status: "done" },
            { id: "solves", status: "skipped" },
            { id: "people", status: "done" },
            { id: "household", status: "skipped" },
            { id: "profile", status: "done" },
          ],
        }),
        member(SIGNUP, {
          activation: facts({
            copyCreatedAts: threeCopies,
            completionCreatedAts: [SIGNUP + 10 * DAY],
            household: { joinedAt: SIGNUP, hasOtherMember: true },
          }),
          welcomeAnswered: true,
          steps: [
            { id: "puzzles", status: "done" },
            { id: "solves", status: "done" },
            { id: "people", status: "done" },
            { id: "household", status: "done" },
            { id: "profile", status: "done" },
          ],
        }),
        member(SIGNUP, {
          activation: facts({ completionCreatedAts: [SIGNUP] }),
        }),
        member(SIGNUP),
      ],
      { from, to: from + 7 * DAY, now },
    );
    const [cohort] = report.cohorts;
    expect(report.cohorts).toHaveLength(1);
    expect(cohort).toEqual({
      from,
      to: from + 7 * DAY,
      windowClosed: true,
      signedUp: 4,
      activated: 2,
      rate: 0.5,
      breakdown: {
        copies3: 2,
        completion: 1,
        mutual: 1,
        household: 1,
        connection: 2,
        completion14d: 2,
      },
      funnel: {
        signedUp: 4,
        welcomeAnswered: 2,
        startedQuickStart: 1,
        copies3: 2,
        activated: 2,
        quickStartCompleted: 1,
        householdLinkCreated: 1,
      },
      steps: {
        puzzles: { done: 2, skipped: 0 },
        solves: { done: 1, skipped: 1 },
        people: { done: 2, skipped: 0 },
        household: { done: 1, skipped: 1 },
        profile: { done: 2, skipped: 0 },
      },
    });
    expect(report.total).toEqual(cohort);
  });

  it("quick start counts as completed only when every required step is done", () => {
    const required = (status: "done" | "todo") => [
      { id: "puzzles" as const, status: "done" as const },
      { id: "solves" as const, status: "done" as const },
      { id: "people" as const, status: "done" as const },
      { id: "household" as const, status: "todo" as const },
      { id: "profile" as const, status },
    ];
    const report = summarizeActivation(
      [
        member(SIGNUP, { steps: required("done") }),
        member(SIGNUP, { steps: required("todo") }),
        member(SIGNUP),
      ],
      { from, to: from + DAY, now },
    );
    expect(report.total.funnel.quickStartCompleted).toBe(1);
  });

  it("marks a cohort open until its last member's 7-day window has passed", () => {
    const cohortTo = from + 7 * DAY;
    const closedAt = cohortTo + 7 * DAY;
    const at = (n: number) =>
      summarizeActivation([], { from, to: cohortTo, now: n }).cohorts[0]
        .windowClosed;
    expect(at(closedAt)).toBe(true);
    expect(at(closedAt - 1)).toBe(false);
  });

  it("reports a rate of 0 for an empty cohort", () => {
    const report = summarizeActivation([], { from, to: from + DAY, now });
    expect(report.total).toMatchObject({ signedUp: 0, activated: 0, rate: 0 });
  });
});
