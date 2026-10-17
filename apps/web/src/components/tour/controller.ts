import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import type { TourDefinition, TourStep } from "./definitions";

// The tour runner's state machine, free of React and the DOM so it can be unit-tested with fake
// timers. The provider wires it to TanStack Router (navigate, pathname), `document` (anchors) and
// `recordTourProgress`, and renders its snapshot.

/** How long a step waits for its page and anchor after navigating (spec Part B §5.3). */
export const ANCHOR_TIMEOUT_MS = 3000;
/** A same-page target may still be loading (a query, a skeleton); wait this long before giving up. */
export const SAME_PAGE_GRACE_MS = 500;
export const ANCHOR_POLL_MS = 100;

export type TourPhase =
  /** Navigating to the step's page or waiting for its anchor: centred card with a spinner. */
  | "pending"
  /** The anchor is on screen: spotlight plus the anchored card. */
  | "shown"
  /** No anchor (none defined, or it never appeared): centred card, full dim, no spotlight. */
  | "missing";

export type TourSnapshot<T> =
  | { status: "idle" }
  | {
      status: "running";
      tourId: string;
      index: number;
      total: number;
      step: TourStep;
      phase: TourPhase;
      /** Set only in the "shown" phase. */
      target: T | null;
      /**
       * The lit target asks the member to press it (`data-tour-action`): no Next, and the tour
       * moves on by itself once the target is gone (spec: action steps).
       */
      action: boolean;
      /** The step lives on another page than the one the tour came from (pending copy). */
      crossRoute: boolean;
      /** Route of the following step, for "Next: <page>"; undefined on the last step. */
      nextRoute?: string;
    };

export interface TourProgressWrite {
  tourId: string;
  status: "in_progress" | "completed";
  step?: number;
}

export type TourEndReason = "paused" | "completed";

export interface TourControllerDeps<T> {
  tours: ReadonlyMap<string, TourDefinition>;
  currentPath: () => string;
  navigate: (route: string) => void;
  /** The visible element carrying `data-tour="<anchor>"`, if any. */
  findTarget: (anchor: string) => T | null;
  /** The target waits for the member to press it instead of offering Next. */
  isActionTarget: (target: T) => boolean;
}

/** Side effects the provider connects after mount (they change across renders). */
export interface TourIO {
  /** Persist progress (fire-and-forget). */
  record: (write: TourProgressWrite) => void;
  onEnd: (end: {
    tourId: string;
    index: number;
    reason: TourEndReason;
  }) => void;
}

const NO_IO: TourIO = { record: () => {}, onEnd: () => {} };

const IDLE = { status: "idle" } as const;

export const samePath = (a: string, b: string): boolean =>
  (a.replace(/\/+$/, "") || "/") === (b.replace(/\/+$/, "") || "/");

/**
 * Resolve once `check()` is true, polling every `intervalMs`; false after `timeoutMs` or as soon as
 * `cancelled()` turns true. Checks immediately first.
 */
export function waitFor(
  check: () => boolean,
  {
    timeoutMs,
    intervalMs = ANCHOR_POLL_MS,
    cancelled = () => false,
  }: { timeoutMs: number; intervalMs?: number; cancelled?: () => boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    let waited = 0;
    const tick = () => {
      if (cancelled()) return resolve(false);
      if (check()) return resolve(true);
      if (waited >= timeoutMs) return resolve(false);
      waited += intervalMs;
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/** Where "Take the tour" starts: the saved step of a paused tour, else the beginning. */
export function resolveStartIndex(
  progress: WhatsNewTourProgressView | undefined,
  total: number,
): number {
  if (progress?.status !== "in_progress" || progress.step === undefined) {
    return 0;
  }
  return Math.min(Math.max(0, progress.step), total - 1);
}

export type TourButtonState =
  | { kind: "take" }
  | { kind: "replay" }
  | { kind: "resume"; step: number; total: number };

/** The entry's tour button (spec Part B §1.7). `step` is 1-based for display. */
export function tourButtonState(
  progress: WhatsNewTourProgressView | undefined,
  total: number,
): TourButtonState {
  if (progress?.status === "completed") return { kind: "replay" };
  if (progress?.status === "in_progress" && progress.step !== undefined) {
    return {
      kind: "resume",
      step: resolveStartIndex(progress, total) + 1,
      total,
    };
  }
  return { kind: "take" };
}

export type TourKeyAction = "next" | "back" | "pause";

/** Keyboard map inside the step card (spec Part B §5.4). Back is ignored on the first step. */
export function tourKeyAction(
  key: string,
  { isFirstStep }: { isFirstStep: boolean },
): TourKeyAction | null {
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return isFirstStep ? null : "back";
  if (key === "Escape") return "pause";
  return null;
}

export type TourNextLabel =
  { kind: "done" } | { kind: "next" } | { kind: "nextOnPage"; route: string };

/** "Done" on the last step, "Next: <page>" when the next step is on another page, else "Next". */
export function tourNextLabel(snapshot: {
  index: number;
  total: number;
  step: TourStep;
  nextRoute?: string;
}): TourNextLabel {
  if (snapshot.index === snapshot.total - 1 || !snapshot.nextRoute) {
    return { kind: "done" };
  }
  if (!samePath(snapshot.nextRoute, snapshot.step.route)) {
    return { kind: "nextOnPage", route: snapshot.nextRoute };
  }
  return { kind: "next" };
}

/** Mobile: dock the card to the top when the target sits in the bottom 45% of the viewport. */
export function dockSide(
  rect: { top: number; bottom: number },
  viewportHeight: number,
): "top" | "bottom" {
  return (rect.top + rect.bottom) / 2 > viewportHeight * 0.55
    ? "top"
    : "bottom";
}

export class TourController<T> {
  private snapshot: TourSnapshot<T> = IDLE;
  private listeners = new Set<() => void>();
  // Bumped on every step entry and on end, so a stale anchor wait cannot overwrite a newer state.
  private generation = 0;
  private io: TourIO = NO_IO;

  constructor(private readonly deps: TourControllerDeps<T>) {}

  /** Route progress writes and end events to `io` until the returned disconnect runs. */
  connect(io: TourIO): () => void {
    this.io = io;
    return () => {
      if (this.io === io) this.io = NO_IO;
    };
  }

  getSnapshot = (): TourSnapshot<T> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Start (or resume) `tourId` at `index`. Unknown tours are ignored. */
  start(tourId: string, index = 0): void {
    const tour = this.deps.tours.get(tourId);
    if (!tour || tour.steps.length === 0) return;
    this.enter(tour, Math.min(Math.max(0, index), tour.steps.length - 1));
  }

  next(): void {
    const s = this.snapshot;
    if (s.status !== "running") return;
    if (s.index === s.total - 1) {
      this.io.record({ tourId: s.tourId, status: "completed" });
      this.end("completed");
      return;
    }
    this.enter(this.deps.tours.get(s.tourId)!, s.index + 1);
  }

  back(): void {
    const s = this.snapshot;
    if (s.status !== "running" || s.index === 0) return;
    this.enter(this.deps.tours.get(s.tourId)!, s.index - 1);
  }

  /** Esc or the close button: stop here. The step was saved on entry, so "Resume" picks it up. */
  pause(): void {
    if (this.snapshot.status === "running") this.end("paused");
  }

  /** Apply a key pressed inside the card; true when it was a tour key. */
  handleKey(key: string): boolean {
    const s = this.snapshot;
    if (s.status !== "running") return false;
    const action = tourKeyAction(key, { isFirstStep: s.index === 0 });
    // An action step has no Next: only pressing its target moves the tour on.
    if (action === "next" && s.action) return false;
    if (action === "next") this.next();
    else if (action === "back") this.back();
    else if (action === "pause") this.pause();
    return action !== null;
  }

  private enter(tour: TourDefinition, index: number): void {
    const generation = ++this.generation;
    const step = tour.steps[index];
    this.io.record({ tourId: tour.id, status: "in_progress", step: index });

    const crossRoute = !samePath(this.deps.currentPath(), step.route);
    if (crossRoute) this.deps.navigate(step.route);

    const base = {
      status: "running" as const,
      tourId: tour.id,
      index,
      total: tour.steps.length,
      step,
      crossRoute,
      nextRoute: tour.steps[index + 1]?.route,
    };
    const onPage = () => samePath(this.deps.currentPath(), step.route);
    const target = () =>
      step.target !== undefined ? this.deps.findTarget(step.target) : null;
    const settle = () => {
      const found = onPage() ? target() : null;
      // The anchor is missing because an earlier step's action was never taken (a resumed tour, or
      // one started elsewhere): go back to the nearest such step on this page instead of explaining
      // something that is not there.
      if (!found && step.target !== undefined) {
        for (let j = index - 1; j >= 0; j--) {
          const earlier = tour.steps[j];
          if (!samePath(this.deps.currentPath(), earlier.route)) break;
          const el =
            earlier.target !== undefined
              ? this.deps.findTarget(earlier.target)
              : null;
          if (el !== null && this.deps.isActionTarget(el)) {
            this.enter(tour, j);
            return;
          }
        }
      }
      const action = found !== null && this.deps.isActionTarget(found);
      this.set({
        ...base,
        phase: found ? "shown" : "missing",
        target: found,
        action,
      });
      // Pressing an action target changes the page (the empty state's button gives way to the new
      // content): once the anchor no longer resolves to that element, the action is done.
      if (action) {
        void waitFor(() => target() !== found, {
          timeoutMs: Number.POSITIVE_INFINITY,
          cancelled: () => generation !== this.generation,
        }).then((done) => {
          if (done && generation === this.generation) this.next();
        });
      }
    };

    // Fast path: already on the page with the anchor (or nothing to wait for) — no pending flash.
    if (!crossRoute && (step.target === undefined || target() !== null)) {
      settle();
      return;
    }

    this.set({ ...base, phase: "pending", target: null, action: false });
    void waitFor(
      () => onPage() && (step.target === undefined || target() !== null),
      {
        timeoutMs: crossRoute ? ANCHOR_TIMEOUT_MS : SAME_PAGE_GRACE_MS,
        cancelled: () => generation !== this.generation,
      },
    ).then(() => {
      if (generation === this.generation) settle();
    });
  }

  private end(reason: TourEndReason): void {
    const s = this.snapshot;
    if (s.status !== "running") return;
    this.generation++;
    this.set(IDLE);
    this.io.onEnd({ tourId: s.tourId, index: s.index, reason });
  }

  private set(next: TourSnapshot<T>): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
