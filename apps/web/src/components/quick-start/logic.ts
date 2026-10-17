// Pure quick start display rules (spec 2026-10-17 §2), kept free of React/Convex so they
// unit-test in node. "Done" comes from the server (onboarding.quickStart); these rules only
// decide what the welcome dialog, the /welcome flow and the dashboard card show.

import type {
  QuickStartStepId,
  QuickStartStepView,
  QuickStartView,
} from "@jigswap/contracts";

/** The `/welcome?step=` values, in flow order. */
export const FLOW_STEPS = [
  "puzzles",
  "solves",
  "people",
  "household",
  "profile",
  "done",
] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** validateSearch for `step`: one of FLOW_STEPS, else undefined (resolved on the page). */
export function parseFlowStep(value: unknown): FlowStep | undefined {
  return (FLOW_STEPS as readonly unknown[]).includes(value)
    ? (value as FlowStep)
    : undefined;
}

/**
 * The step to show. A requested step is always honoured (any step can be opened from the card);
 * without one, the first required step that is neither done nor skipped, or `done`. Undefined
 * while the view is loading.
 */
export function resolveFlowStep(
  requested: FlowStep | undefined,
  view: QuickStartView | undefined,
): FlowStep | undefined {
  if (requested) return requested;
  if (!view) return undefined;
  return (
    view.steps.find((s) => !s.optional && s.status === "todo")?.id ?? "done"
  );
}

export function nextFlowStep(step: FlowStep): FlowStep {
  return FLOW_STEPS[
    Math.min(FLOW_STEPS.indexOf(step) + 1, FLOW_STEPS.length - 1)
  ];
}

/** Required steps are numbered 1–4 ("Step 2 of 4"); household is the optional step. */
export function stepPosition(
  id: QuickStartStepId,
): { kind: "required"; index: number } | { kind: "optional" } {
  if (id === "household") return { kind: "optional" };
  const required = FLOW_STEPS.filter(
    (s): s is QuickStartStepId => s !== "household" && s !== "done",
  );
  return { kind: "required", index: required.indexOf(id) + 1 };
}

/** One flag per required step, in order: filled when done (D9: four segments). */
export function progressSegments(
  steps: readonly QuickStartStepView[],
): boolean[] {
  return steps.filter((s) => !s.optional).map((s) => s.status === "done");
}

export type RowState = "todo" | "inProgress" | "done" | "skipped";

/** A card row's state. "In progress" is a partial count: 1 or 2 of the 3 copies step 1 needs. */
export function rowState(step: QuickStartStepView): RowState {
  if (step.status !== "todo") return step.status;
  return step.id === "puzzles" && (step.count ?? 0) > 0 ? "inProgress" : "todo";
}

/** Counts are read with a cap of 51, which means "50+". */
export function displayCount(count: number | undefined): string {
  const n = count ?? 0;
  return n > 50 ? "50+" : String(n);
}

/**
 * Whether the welcome dialog reports the surface busy (§2.1). It reports while the member or the
 * onboarding query is still loading, not only while it is open: the highlight checks once after
 * its 600 ms timer, and the welcome can only open after the query resolves.
 */
export function welcomeSurfaceBusy({
  memberLoading,
  hasMember,
  view,
}: {
  memberLoading: boolean;
  hasMember: boolean;
  view: QuickStartView | undefined;
}): boolean {
  if (memberLoading) return true;
  if (!hasMember) return false;
  return view === undefined || view.showWelcome;
}

/**
 * D7: InviteRedeemer skips its loop QR dialog and "Did someone invite you?" toast while the member
 * is eligible and the card is showing (step 3 offers both). Undefined while loading.
 */
export function inviteExtrasSuppressed(
  view: QuickStartView | undefined,
): boolean | undefined {
  if (!view) return undefined;
  return view.eligible && view.cardVisible;
}

/**
 * The dashboard card's mode (§2.3). The server hides the card once no required step is open, so
 * the one-row "all set up" state is client-side: it shows in a session in which the quick start
 * was used, until the member hides it.
 */
export function cardMode({
  view,
  usedThisSession,
  hiddenThisSession,
}: {
  view: QuickStartView | undefined;
  usedThisSession: boolean;
  hiddenThisSession: boolean;
}): "hidden" | "active" | "allDone" {
  if (!view || hiddenThisSession) return "hidden";
  if (view.cardVisible) return "active";
  const allClosed = view.steps.every((s) => s.optional || s.status !== "todo");
  return allClosed && usedThisSession ? "allDone" : "hidden";
}

/** §2.7: offer push only after a social action, on a capable device that was never asked. */
export function shouldOfferPush({
  triggered,
  supported,
  permission,
  configured,
  asked,
}: {
  triggered: boolean;
  supported: boolean;
  permission: NotificationPermission | null;
  configured: boolean;
  asked: boolean;
}): boolean {
  return (
    triggered && supported && permission === "default" && configured && !asked
  );
}

/**
 * Whether a focused element raises the on-screen keyboard. B11: the sticky /welcome footer hides
 * on phones while one is focused, so footer, tab bar and keyboard don't cover the step.
 */
export function isTextEntry(el: { tagName: string; type?: string }): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  return [
    "text",
    "search",
    "email",
    "url",
    "tel",
    "number",
    "password",
    "",
  ].includes((el.type ?? "").toLowerCase());
}
