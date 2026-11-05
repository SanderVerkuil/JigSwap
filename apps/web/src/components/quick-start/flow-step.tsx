"use client";

import type { QuickStartStepId, QuickStartView } from "@jigswap/contracts";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { QuickStartFlowView } from "./flow-view";
import { LeaveStepDialog } from "./leave-step-dialog";
import {
  createContinueRunner,
  createLeaveGuard,
  createStepCommitStore,
  hasPendingWork,
  StepCommitContext,
  useStepCommitSnapshot,
} from "./step-commit";

/**
 * One /welcome step (UX-16). Render it keyed by the step, so each step starts with its own commit
 * store. The step's body (from `renderBody`) publishes its unsaved work there; Continue saves it
 * (single flight) and calls `onNext` only once it saved. A failed save keeps the member on the
 * step with their work (the step toasts why). Leaving any other way while work is unsaved
 * (Finish later, a stepper link, Back, a link in the step, Skip, closing the tab) asks "Leave
 * without saving?" first, unless the step keeps that work for the page it's leaving for (the
 * picker's Register); Skip is only stored (`onSkip`) after Discard. `renderBody` gets that guarded
 * skip for steps with their own skip-like action.
 */
export function QuickStartFlowStep({
  step,
  view,
  onSkip,
  onNext,
  renderBody,
}: {
  step: QuickStartStepId;
  view: QuickStartView;
  onSkip: () => void;
  onNext: () => void;
  renderBody: (skip: () => void) => ReactNode;
}) {
  const [store] = useState(createStepCommitStore);
  const pendingWork = useStepCommitSnapshot(store);
  const [continuing, setContinuing] = useState(false);
  const [runner] = useState(() => createContinueRunner(setContinuing));
  // A save that lands after the member already left (Finish later mid-save) must not pull them
  // back into the flow.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // This step's own Continue and Skip mark the guard as leaving, so it lets that navigation
  // through even before the cleared step has published "nothing pending".
  const [guard] = useState(() => createLeaveGuard(store, runner));
  const blocker = useBlocker({
    shouldBlockFn: guard.shouldBlock,
    // Called without a destination, so it asks for any work: closing the tab loses it either way.
    enableBeforeUnload: guard.shouldAsk,
    withResolver: true,
  });
  const [askingSkip, setAskingSkip] = useState(false);

  const onContinue = () => {
    const work = store.getSnapshot();
    if (hasPendingWork(work) && !work.ready) return;
    void runner.run({
      commit: hasPendingWork(work) ? store.commit : null,
      go: () => {
        if (!mounted.current) return;
        guard.leave();
        onNext();
      },
    });
  };
  const skip = () => (guard.shouldAsk() ? setAskingSkip(true) : onSkip());
  const keepEditing = () => {
    if (blocker.status === "blocked") blocker.reset();
    setAskingSkip(false);
  };
  const discard = () => {
    setAskingSkip(false);
    store.discard();
    if (blocker.status === "blocked") {
      blocker.proceed();
      return;
    }
    guard.leave();
    onSkip();
  };

  return (
    <>
      <QuickStartFlowView
        step={step}
        view={view}
        onSkip={skip}
        onContinue={onContinue}
        pendingWork={pendingWork}
        continuing={continuing}
      >
        <StepCommitContext value={store}>{renderBody(skip)}</StepCommitContext>
      </QuickStartFlowView>
      <LeaveStepDialog
        open={blocker.status === "blocked" || askingSkip}
        work={pendingWork}
        onKeep={keepEditing}
        onDiscard={discard}
      />
    </>
  );
}
