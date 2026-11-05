"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Recall a lent-out copy. Recalling ends the loan and records the puzzle as back with the owner
// straight away (library/recallLoan), so it always asks first and reports the outcome either way.
// The server decides who may recall (the lender or a household manager of the copy).
export function RecallLoanButton({
  loanId,
  borrowerName,
}: {
  /** The open loan's domain id (LoanView.loanId). */
  loanId: string;
  /** The borrower's display name as the viewer may see it (projected). */
  borrowerName: string;
}) {
  const t = useTranslations("lending");
  const tCommon = useTranslations("common");
  const recall = useMutation({
    mutationFn: useConvexMutation(gateway.lending.recallLoan),
  });

  const confirm = async () => {
    try {
      await recall.mutateAsync({ loanId });
      toast.success(t("recalled"));
    } catch {
      toast.error(t("recallFailed"));
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={recall.isPending}
          className="pointer-coarse:min-h-11"
        >
          <Undo2 />
          {recall.isPending ? t("recalling") : t("recallAction")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("recallConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("recallConfirmBody", { name: borrowerName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>
            {t("recallConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
