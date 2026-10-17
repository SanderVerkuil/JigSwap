// Quick start read model (`onboarding.quickStart`) and write commands (`onboarding.recordQuickStart`).
// Step "done" is derived server-side from the member's real data; only skipped steps and the
// welcome/card dismissals are stored.

export type QuickStartStepId =
  "puzzles" | "solves" | "people" | "household" | "profile";

export type QuickStartStepStatus = "todo" | "done" | "skipped";

export interface QuickStartStepView {
  id: QuickStartStepId;
  status: QuickStartStepStatus;
  /** Only household is optional; it never counts toward `requiredDone`. */
  optional: boolean;
  /** puzzles: copies, solves: finished solves, people: members followed. Capped at 51 ("50+"). */
  count?: number;
  /** household only: an invite to a household is waiting for the member. */
  pendingInvite?: boolean;
}

export interface QuickStartView {
  /** The account is younger than 7 days. */
  eligible: boolean;
  /** Eligible and the welcome dialog was never dismissed. */
  showWelcome: boolean;
  /** Not dismissed, a required step is still open, and the account is < 30 days old or has 0 copies. */
  cardVisible: boolean;
  steps: QuickStartStepView[];
  requiredDone: number;
  requiredTotal: number;
}

export type QuickStartCommand =
  | { kind: "skipStep" | "unskipStep"; step: QuickStartStepId }
  | {
      kind:
        | "dismissWelcome"
        | "dismissCard"
        | "restoreCard"
        // The first /welcome visit; recorded once, for the activation report's funnel.
        | "startQuickStart";
    };
