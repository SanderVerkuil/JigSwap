"use client";

// Shared disable/re-enable lifecycle affordance used by BOTH the /admin/puzzles
// list rows and the /admin/puzzles/$puzzleId detail page (the two call sites
// that justify the extraction). Renders the status-appropriate trigger button
// and calls the catalog disable/reenable mutations. Both directions are
// reversible, so each success toast offers Undo (the opposite mutation, whose
// own toast offers Undo again). Disabling hides a public puzzle, so it still
// asks first in an AlertDialog; re-enabling is the safe direction and fires at
// once. Legacy definitions without an aggregateId still render the button but
// keep it disabled — the mutations key on the Catalog aggregate.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type LifecycleAction = "disable" | "reenable";

const OPPOSITE: Record<LifecycleAction, LifecycleAction> = {
  disable: "reenable",
  reenable: "disable",
};

export function PuzzleLifecycleAction({
  aggregateId,
  title,
  status,
}: {
  aggregateId?: string;
  title: string;
  status: "pending" | "approved" | "rejected" | "disabled";
}) {
  const t = useTranslations("admin.puzzles");
  const tCommon = useTranslations("common");

  const disableFn = useConvexMutation(gateway.catalog.disable);
  const reenableFn = useConvexMutation(gateway.catalog.reenable);
  // One observer for both directions, so an Undo also shows as busy. A react-query mutation still
  // runs when the toast's Undo fires after this button re-rendered for the new status.
  const lifecycle = useMutation({
    mutationFn: ({ action, id }: { action: LifecycleAction; id: string }) =>
      (action === "disable" ? disableFn : reenableFn)({
        puzzleDefinitionId: id,
      }),
  });
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const busy = lifecycle.isPending;

  // Runs one direction and toasts with an Undo that runs the other.
  const run = async (action: LifecycleAction, id: string) => {
    try {
      await lifecycle.mutateAsync({ action, id });
      toast.success(
        t(action === "disable" ? "disableSuccess" : "reenableSuccess", {
          title,
        }),
        {
          action: {
            label: t("undo"),
            onClick: () => void run(OPPOSITE[action], id),
          },
        },
      );
    } catch {
      toast.error(t(action === "disable" ? "disableError" : "reenableError"));
    }
  };

  return (
    <>
      {status === "approved" && (
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={busy || !aggregateId}
          onClick={() => setConfirmingDisable(true)}
        >
          {t("disable")}
        </Button>
      )}
      {status === "disabled" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !aggregateId}
          onClick={() => {
            if (aggregateId) void run("reenable", aggregateId);
          }}
        >
          {t("reenable")}
        </Button>
      )}
      <AlertDialog open={confirmingDisable} onOpenChange={setConfirmingDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("disableConfirmTitle", { title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("disableConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (aggregateId) void run("disable", aggregateId);
              }}
            >
              {t("disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
