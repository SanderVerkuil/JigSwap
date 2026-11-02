import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

// Continue in the quick setup flow saves what the member picked, ticked or typed on the step
// (UX-16). Each step publishes its unsaved work to a per-step store; the flow's footer reads it
// to relabel Continue ("Add 3 and continue") and calls the step's commit before going on.

/** The kind of work a step holds until it is saved; picks the footer's label. */
export type StepCommitKind = "puzzles" | "solves" | "profile";

export interface StepCommitSnapshot {
  kind: StepCommitKind;
  /** Picks, ticked rows or changed fields not saved yet; 0 when there is nothing to save. */
  count: number;
  /** False while the work can't be saved yet (a ticked row still needs its date). */
  ready: boolean;
}

/**
 * Saves the step's pending work. Resolves true once saved; on failure the step has already told
 * the member (its own toast) and resolves false, so the flow stays on the step.
 */
export type StepCommit = () => Promise<boolean>;

/** For work a step keeps outside its own state (the picker's tray), so leaving need not lose it. */
export interface StepKept {
  /** Pages the work survives leaving for: leaving for those never asks. */
  outlives: (pathname: string) => boolean;
  /** Drops the kept work: the member chose Discard. */
  discard: () => void;
}

export interface StepCommitStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StepCommitSnapshot | null;
  /** Replaces the snapshot; listeners hear about it only when the content changed. */
  publish: (snapshot: StepCommitSnapshot | null) => void;
  setCommit: (commit: StepCommit | null) => void;
  /** Runs the latest registered commit; with none registered there is nothing to save. */
  commit: StepCommit;
  setKept: (kept: StepKept | null) => void;
  outlives: (pathname: string) => boolean;
  discard: () => void;
}

const sameSnapshot = (
  a: StepCommitSnapshot | null,
  b: StepCommitSnapshot | null,
) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.count === b.count &&
    a.ready === b.ready);

export function createStepCommitStore(): StepCommitStore {
  let snapshot: StepCommitSnapshot | null = null;
  let latest: StepCommit | null = null;
  let kept: StepKept | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    publish: (next) => {
      if (sameSnapshot(snapshot, next)) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
    setCommit: (commit) => {
      latest = commit;
    },
    commit: () => (latest ? latest() : Promise.resolve(true)),
    setKept: (next) => {
      kept = next;
    },
    outlives: (pathname) => kept?.outlives(pathname) ?? false,
    discard: () => kept?.discard(),
  };
}

/** True when the step holds work that Continue would save and leaving would drop. */
export const hasPendingWork = (
  snapshot: StepCommitSnapshot | null,
): snapshot is StepCommitSnapshot => snapshot !== null && snapshot.count > 0;

/** Provided by /welcome around the step's body; absent everywhere else. */
export const StepCommitContext = createContext<StepCommitStore | null>(null);

/**
 * Registers a step's unsaved work with the quick setup flow. Effects only (no state): the
 * snapshot is published whenever it changes, the latest commit after every render, and both are
 * cleared when the step unmounts. Returns whether the step is inside the flow, where the flow's
 * Continue saves the work, so the step hides its own submit. A no-op outside /welcome.
 */
export function useStepCommitRegistration({
  kind,
  count,
  ready,
  commit,
  kept = null,
}: StepCommitSnapshot & {
  commit: StepCommit;
  kept?: StepKept | null;
}): boolean {
  const store = useContext(StepCommitContext);
  useEffect(() => {
    store?.setCommit(commit);
    store?.setKept(kept);
  });
  useEffect(() => {
    store?.publish({ kind, count, ready });
  }, [store, kind, count, ready]);
  useEffect(() => {
    if (!store) return;
    return () => {
      store.publish(null);
      store.setCommit(null);
      store.setKept(null);
    };
  }, [store]);
  return store !== null;
}

const noPendingWork = () => null;

/** The step's unsaved work as the flow sees it; null on the server and before a step registers. */
export function useStepCommitSnapshot(store: StepCommitStore) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    noPendingWork,
  );
}

export type ContinueOutcome = "went" | "stayed" | "ignored";

export interface ContinueRunner {
  /**
   * Saves `commit` (when there is pending work) and calls `go` only once it saved. While a save
   * is in flight every further call is ignored, so a double tap never saves twice.
   */
  run: (args: {
    commit: StepCommit | null;
    go: () => void;
  }) => Promise<ContinueOutcome>;
  isBusy: () => boolean;
}

/** Continue's single flight; `onBusyChange` drives the footer's busy state. */
export function createContinueRunner(
  onBusyChange: (busy: boolean) => void,
): ContinueRunner {
  let busy = false;
  return {
    isBusy: () => busy,
    run: async ({ commit, go }) => {
      if (busy) return "ignored";
      if (!commit) {
        go();
        return "went";
      }
      busy = true;
      onBusyChange(true);
      let saved = false;
      try {
        saved = await commit();
      } catch (error) {
        console.error("Failed to save the quick setup step:", error);
      } finally {
        busy = false;
        onBusyChange(false);
      }
      if (!saved) return "stayed";
      go();
      return "went";
    },
  };
}

export interface LeaveGuard {
  /**
   * True while leaving the step (Finish later, a stepper link, Back, a link in the step, Skip,
   * closing the tab) would drop unsaved work, so the flow asks first. Never once the member is
   * moving on on purpose, nor while Continue is saving (that work is already on its way), nor on
   * the way to a page the step's kept work survives (`nextPathname`).
   */
  shouldAsk: (nextPathname?: string) => boolean;
  /** shouldAsk in the shape of useBlocker's shouldBlockFn. */
  shouldBlock: (args: { next: { pathname: string } }) => boolean;
  /** The member moves on on purpose: Continue saved, or they chose Discard on Skip. */
  leave: () => void;
}

/** The leave guard of one quick setup step (UX-16), over its commit store and Continue runner. */
export function createLeaveGuard(
  store: StepCommitStore,
  runner: ContinueRunner,
): LeaveGuard {
  let leaving = false;
  const shouldAsk = (nextPathname?: string) =>
    !leaving &&
    !runner.isBusy() &&
    hasPendingWork(store.getSnapshot()) &&
    !(nextPathname !== undefined && store.outlives(nextPathname));
  return {
    shouldAsk,
    shouldBlock: ({ next }) => shouldAsk(next.pathname),
    leave: () => {
      leaving = true;
    },
  };
}
