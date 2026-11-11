"use client";

import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { LeaveStepDialog, type LeaveWork } from "./leave-step-dialog";

/**
 * "Leave without saving?" for a page holding unsaved work outside quick setup (where
 * QuickStartFlowStep does this over its own commit store). While `work` is set, any way out (a nav
 * link, Back, Cancel, closing the tab) asks first. A deliberate exit after saving navigates with
 * `ignoreBlocker`; `outlives` names pages the work survives leaving for, so those never ask.
 * Discard runs `onDiscard` (for work kept outside the page) and carries on to where the member was
 * heading.
 */
export function LeaveGuard({
  work,
  outlives,
  onDiscard,
}: {
  work: LeaveWork | null;
  outlives?: (pathname: string) => boolean;
  onDiscard?: () => void;
}) {
  const shouldBlockFn = useCallback(
    ({ next }: { next: { pathname: string } }) => !outlives?.(next.pathname),
    [outlives],
  );
  const blocker = useBlocker({
    shouldBlockFn,
    disabled: work === null,
    withResolver: true,
  });
  // A save on its way when the member tapped out can land while the dialog asks. With nothing left
  // to lose, it closes as Keep editing would: the page shows what the save led to.
  useEffect(() => {
    if (work === null && blocker.status === "blocked") blocker.reset?.();
  }, [work, blocker]);
  return (
    <LeaveStepDialog
      open={blocker.status === "blocked"}
      work={work}
      onKeep={() => blocker.reset?.()}
      onDiscard={() => {
        onDiscard?.();
        blocker.proceed?.();
      }}
    />
  );
}
