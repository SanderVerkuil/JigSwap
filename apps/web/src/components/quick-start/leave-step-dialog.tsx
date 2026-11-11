"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useRef } from "react";
import { useTranslations } from "use-intl";
import type { StepCommitKind } from "./step-commit";

/** What leaving would drop: a quick setup step's unsaved work, a filled-in add form or an edit. */
export interface LeaveWork {
  kind: StepCommitKind | "addForm" | "suggestEdit";
  count: number;
}

/**
 * "Leave without saving?" (UX-16): shown when the member leaves a quick setup step that still
 * holds unsaved work. Keep editing (the default focus, also Escape) stays on the step with the
 * work intact; Discard lets the navigation (or Skip) go ahead without saving. The dialog opens
 * without a trigger, so it hands focus back itself to whatever had it before (the Finish later
 * link, Skip, a ticked row), as long as that is still on the page.
 */
export function LeaveStepDialog({
  open,
  work,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  work: LeaveWork | null;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("quickStart.flow.discard");
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <AlertDialogContent
        // Runs before Radix moves focus into the dialog, so activeElement is still the origin.
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          const origin = returnFocus.current;
          returnFocus.current = null;
          if (origin?.isConnected) {
            event.preventDefault();
            origin.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {work && t(work.kind, { count: work.count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="pointer-coarse:min-h-11">
            {t("keep")}
          </AlertDialogCancel>
          {/* A plain button, not AlertDialogAction: closing through Radix would also run
              onKeep and undo the choice. The parent closes the dialog once it acted. */}
          <Button
            variant="destructive"
            className="pointer-coarse:min-h-11"
            onClick={onDiscard}
          >
            {t("discard")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
