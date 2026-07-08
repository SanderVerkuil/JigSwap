"use client";

// Shared disable/re-enable lifecycle affordance used by BOTH the /admin/puzzles
// list rows and the /admin/puzzles/$puzzleId detail page (the two call sites
// that justify the extraction). Renders the status-appropriate trigger button
// plus its controlled AlertDialog confirm and calls the catalog disable/reenable
// mutations. Legacy definitions without an aggregateId still render the button
// but keep it disabled — the mutations key on the Catalog aggregate.

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

  const disable = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.disable),
  });
  const reenable = useMutation({
    mutationFn: useConvexMutation(gateway.catalog.reenable),
  });
  const [confirming, setConfirming] = useState<"disable" | "reenable" | null>(
    null,
  );
  const busy = disable.isPending || reenable.isPending;

  const runConfirmed = async () => {
    if (!confirming || !aggregateId) return;
    const action = confirming;
    setConfirming(null);
    try {
      const run = action === "disable" ? disable : reenable;
      await run.mutateAsync({ puzzleDefinitionId: aggregateId });
      toast.success(
        t(action === "disable" ? "disableSuccess" : "reenableSuccess", {
          title,
        }),
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
          onClick={() => setConfirming("disable")}
        >
          {t("disable")}
        </Button>
      )}
      {status === "disabled" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !aggregateId}
          onClick={() => setConfirming("reenable")}
        >
          {t("reenable")}
        </Button>
      )}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "reenable"
                ? t("reenableConfirmTitle", { title })
                : t("disableConfirmTitle", { title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "reenable"
                ? t("reenableConfirmBody")
                : t("disableConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirming === "disable"
                  ? buttonVariants({ variant: "destructive" })
                  : undefined
              }
              onClick={() => void runConfirmed()}
            >
              {confirming === "reenable" ? t("reenable") : t("disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
