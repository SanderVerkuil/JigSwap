// Activation (quick start spec §1.2, decisions 5 and 10): a member is activated when, within 7 days
// of sign-up (inclusive), they own ≥ 3 copies AND have at least one of: a finished solve (any date
// precision), a mutual connection, or a household link. The backend gathers the facts; the rules
// and the report aggregation live here so the thresholds are unit-tested. Timestamps are epoch ms.
//
// Household link (decision 10): the member created or joined a household inside their window, and
// that household has at least one other member, WHENEVER that member joined. So a member can flip
// to activated after day 7, when a second member joins their household later. The report therefore
// reads current household membership and is not frozen once a cohort's window has closed.

import {
  QUICK_START_COPIES_DONE,
  QUICK_START_STEP_IDS,
  type QuickStartStepId,
} from "./quickStart";

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVATION_WINDOW_MS = 7 * DAY_MS;
/** The secondary "engaged" signal: a finished solve within this long. Not part of activation. */
export const ENGAGED_WINDOW_MS = 14 * DAY_MS;
/** Report cohorts are weekly sign-up buckets. */
export const ACTIVATION_COHORT_MS = 7 * DAY_MS;
/** One report covers at most this much sign-up time, so a single query stays within budget. */
export const ACTIVATION_REPORT_MAX_RANGE_MS = 31 * DAY_MS;

export interface ActivationFacts {
  /** createdAt of the member's own copies. */
  copyCreatedAts: readonly number[];
  /** createdAt of the member's finished solves, at any date precision. */
  completionCreatedAts: readonly number[];
  /** Per mutual connection: when it became mutual (the later of the two follow rows). */
  mutualConnectedAts: readonly number[];
  /** The member's household membership, if any. */
  household?: { joinedAt: number; hasOtherMember: boolean };
}

export interface Activation {
  copies3: boolean;
  completion: boolean;
  mutual: boolean;
  household: boolean;
  activated: boolean;
  /** Secondary signal: a finished solve within 14 days. */
  completion14d: boolean;
}

export const evaluateActivation = (
  facts: ActivationFacts,
  signupAt: number,
): Activation => {
  const within = (windowMs: number) => (t: number) =>
    t >= signupAt && t <= signupAt + windowMs;
  const inWeek = within(ACTIVATION_WINDOW_MS);
  const copies3 =
    facts.copyCreatedAts.filter(inWeek).length >= QUICK_START_COPIES_DONE;
  const completion = facts.completionCreatedAts.some(inWeek);
  const mutual = facts.mutualConnectedAts.some(inWeek);
  const household =
    facts.household !== undefined &&
    facts.household.hasOtherMember &&
    inWeek(facts.household.joinedAt);
  return {
    copies3,
    completion,
    mutual,
    household,
    activated: copies3 && (completion || mutual || household),
    completion14d: facts.completionCreatedAts.some(within(ENGAGED_WINDOW_MS)),
  };
};

export const isActivated = (facts: ActivationFacts, signupAt: number) =>
  evaluateActivation(facts, signupAt).activated;

export const isValidActivationRange = (from: number, to: number): boolean =>
  to > from && to - from <= ACTIVATION_REPORT_MAX_RANGE_MS;

/** One cohort member as the report sees it. Quick start fields are the member's current state. */
export interface ActivationReportMember {
  signupAt: number;
  activation: ActivationFacts;
  welcomeAnswered: boolean;
  startedQuickStart: boolean;
  householdLinkCreated: boolean;
  /** The member's derived quick start steps (deriveQuickStart), optional ones included. */
  steps: readonly {
    id: QuickStartStepId;
    status: "todo" | "done" | "skipped";
  }[];
}

type StepCounts = Record<QuickStartStepId, { done: number; skipped: number }>;

export interface ActivationCohort {
  /** Sign-up bounds, [from, to). */
  from: number;
  to: number;
  /** Every member's 7-day window has passed (to + 7 d <= now). Open cohorts can still grow. */
  windowClosed: boolean;
  signedUp: number;
  activated: number;
  /** activated / signedUp; 0 for an empty cohort. */
  rate: number;
  /** Members meeting each criterion within their window (connection = mutual or household). */
  breakdown: {
    copies3: number;
    completion: number;
    mutual: number;
    household: number;
    connection: number;
    completion14d: number;
  };
  /** The quick start funnel. welcomeAnswered, startedQuickStart, quickStartCompleted and
   * householdLinkCreated are current state, not limited to the window. */
  funnel: {
    signedUp: number;
    welcomeAnswered: number;
    startedQuickStart: number;
    copies3: number;
    activated: number;
    quickStartCompleted: number;
    householdLinkCreated: number;
  };
  /** Per quick start step: members for whom it is done, or skipped and not done. */
  steps: StepCounts;
}

export interface ActivationReport {
  from: number;
  to: number;
  generatedAt: number;
  /** Weekly sign-up cohorts starting at `from`; the last one ends at `to`. */
  cohorts: ActivationCohort[];
  total: ActivationCohort;
}

const OPTIONAL_STEP: QuickStartStepId = "household";

const cohortOf = (
  members: readonly ActivationReportMember[],
  from: number,
  to: number,
  now: number,
): ActivationCohort => {
  const inCohort = members.filter((m) => m.signupAt >= from && m.signupAt < to);
  const results = inCohort.map((m) => ({
    member: m,
    activation: evaluateActivation(m.activation, m.signupAt),
  }));
  const count = (pick: (r: (typeof results)[number]) => boolean): number =>
    results.filter(pick).length;
  const activated = count((r) => r.activation.activated);
  const copies3 = count((r) => r.activation.copies3);
  const steps = Object.fromEntries(
    QUICK_START_STEP_IDS.map((id) => [
      id,
      {
        done: count((r) =>
          r.member.steps.some((s) => s.id === id && s.status === "done"),
        ),
        skipped: count((r) =>
          r.member.steps.some((s) => s.id === id && s.status === "skipped"),
        ),
      },
    ]),
  ) as StepCounts;
  return {
    from,
    to,
    windowClosed: to + ACTIVATION_WINDOW_MS <= now,
    signedUp: inCohort.length,
    activated,
    rate: inCohort.length === 0 ? 0 : activated / inCohort.length,
    breakdown: {
      copies3,
      completion: count((r) => r.activation.completion),
      mutual: count((r) => r.activation.mutual),
      household: count((r) => r.activation.household),
      connection: count((r) => r.activation.mutual || r.activation.household),
      completion14d: count((r) => r.activation.completion14d),
    },
    funnel: {
      signedUp: inCohort.length,
      welcomeAnswered: count((r) => r.member.welcomeAnswered),
      startedQuickStart: count((r) => r.member.startedQuickStart),
      copies3,
      activated,
      quickStartCompleted: count(
        (r) =>
          r.member.steps.length > 0 &&
          r.member.steps.every(
            (s) => s.id === OPTIONAL_STEP || s.status === "done",
          ),
      ),
      householdLinkCreated: count((r) => r.member.householdLinkCreated),
    },
    steps,
  };
};

export const summarizeActivation = (
  members: readonly ActivationReportMember[],
  range: { from: number; to: number; now: number },
): ActivationReport => {
  const { from, to, now } = range;
  const cohorts: ActivationCohort[] = [];
  for (let start = from; start < to; start += ACTIVATION_COHORT_MS) {
    cohorts.push(
      cohortOf(members, start, Math.min(start + ACTIVATION_COHORT_MS, to), now),
    );
  }
  return {
    from,
    to,
    generatedAt: now,
    cohorts,
    total: cohortOf(members, from, to, now),
  };
};
