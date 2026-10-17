// Quick start: a first-sign-in checklist. Each step's "done" is derived from the member's real data
// (facts gathered by the backend); only the member's choices are stored: skipped steps, when the
// welcome dialog / dashboard card were dismissed, and when the member first opened the flow (a
// funnel fact for the activation report). Done wins over skipped. Timestamps are epoch ms.

export const QUICK_START_STEP_IDS = [
  "puzzles",
  "solves",
  "people",
  "household",
  "profile",
] as const;
export type QuickStartStepId = (typeof QUICK_START_STEP_IDS)[number];

const OPTIONAL_STEPS: ReadonlySet<QuickStartStepId> = new Set(["household"]);

/** Step 1 is done at this many copies (the activation threshold). */
export const QUICK_START_COPIES_DONE = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** New members (younger than this) are eligible for the welcome dialog. */
export const QUICK_START_WELCOME_WINDOW_MS = 7 * DAY_MS;
/** The card shows to members younger than this, or to anyone with 0 copies. */
export const QUICK_START_CARD_WINDOW_MS = 30 * DAY_MS;

export interface QuickStartFacts {
  copies: number;
  completions: number; // finished solves, any date precision
  follows: number; // members I follow
  pendingFollowRequests: number; // my pending requests to private profiles
  inHousehold: boolean;
  pendingHouseholdInvite: boolean;
  hasLocation: boolean;
  visibilitySet: boolean; // profile visibility explicitly chosen
}

export interface QuickStartState {
  skippedSteps: QuickStartStepId[];
  welcomeDismissedAt?: number;
  cardDismissedAt?: number;
  /** When the member first opened the /welcome flow. */
  startedAt?: number;
}

export interface QuickStartInput {
  now: number;
  accountCreatedAt: number;
  state: QuickStartState;
  facts: QuickStartFacts;
}

export type QuickStartStepStatus = "todo" | "done" | "skipped";

export interface QuickStartStep {
  id: QuickStartStepId;
  status: QuickStartStepStatus;
  optional: boolean;
  count?: number;
  pendingInvite?: boolean;
}

export interface QuickStart {
  eligible: boolean;
  showWelcome: boolean;
  cardVisible: boolean;
  steps: QuickStartStep[];
  requiredDone: number;
  requiredTotal: number;
}

const stepDetails = (
  id: QuickStartStepId,
  f: QuickStartFacts,
): { done: boolean; count?: number; pendingInvite?: boolean } => {
  switch (id) {
    case "puzzles":
      return { done: f.copies >= QUICK_START_COPIES_DONE, count: f.copies };
    case "solves":
      return { done: f.completions > 0, count: f.completions };
    case "people":
      return {
        done: f.follows > 0 || f.pendingFollowRequests > 0,
        count: f.follows,
      };
    case "household":
      return {
        done: f.inHousehold,
        pendingInvite: f.pendingHouseholdInvite,
      };
    case "profile":
      return { done: f.hasLocation || f.visibilitySet };
  }
};

export const deriveQuickStart = (input: QuickStartInput): QuickStart => {
  const { now, accountCreatedAt, state, facts } = input;
  const skipped = new Set(state.skippedSteps);
  const steps = QUICK_START_STEP_IDS.map((id): QuickStartStep => {
    const { done, ...details } = stepDetails(id, facts);
    const status: QuickStartStepStatus = done
      ? "done"
      : skipped.has(id)
        ? "skipped"
        : "todo";
    return { id, status, optional: OPTIONAL_STEPS.has(id), ...details };
  });
  const required = steps.filter((s) => !s.optional);
  const age = now - accountCreatedAt;
  const eligible = age < QUICK_START_WELCOME_WINDOW_MS;
  const cardVisible =
    state.cardDismissedAt === undefined &&
    required.some((s) => s.status === "todo") &&
    (age < QUICK_START_CARD_WINDOW_MS || facts.copies === 0);
  return {
    eligible,
    showWelcome: eligible && state.welcomeDismissedAt === undefined,
    cardVisible,
    steps,
    requiredDone: required.filter((s) => s.status === "done").length,
    requiredTotal: required.length,
  };
};

export type QuickStartChange =
  | { kind: "skipStep" | "unskipStep"; step: QuickStartStepId }
  | {
      kind:
        "dismissWelcome" | "dismissCard" | "restoreCard" | "startQuickStart";
    };

// The member's stored state after `change`, or null when it changes nothing (so writes are
// idempotent). Skipped steps stay in step order; a repeated dismiss keeps the first timestamp.
export const applyQuickStartChange = (
  state: QuickStartState,
  change: QuickStartChange,
  now: number,
): QuickStartState | null => {
  switch (change.kind) {
    case "skipStep":
    case "unskipStep": {
      const skip = change.kind === "skipStep";
      if (state.skippedSteps.includes(change.step) === skip) return null;
      const skippedSteps = QUICK_START_STEP_IDS.filter((id) =>
        id === change.step ? skip : state.skippedSteps.includes(id),
      );
      return { ...state, skippedSteps };
    }
    case "dismissWelcome":
      return state.welcomeDismissedAt === undefined
        ? { ...state, welcomeDismissedAt: now }
        : null;
    case "dismissCard":
      return state.cardDismissedAt === undefined
        ? { ...state, cardDismissedAt: now }
        : null;
    case "startQuickStart":
      return state.startedAt === undefined
        ? { ...state, startedAt: now }
        : null;
    case "restoreCard": {
      if (state.cardDismissedAt === undefined) return null;
      const { cardDismissedAt: _, ...rest } = state;
      return rest;
    }
  }
};
