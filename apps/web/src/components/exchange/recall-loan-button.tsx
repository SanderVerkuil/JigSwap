// "Recall" on a lent-out copy: the lender (or a household member who may manage the copy) closes
// the loan, and the copy counts as back with its owner. The borrower gets no notification, so the
// confirm says to do this only once the puzzle is back. Same answer-back pattern as Return: a
// confirm stating the consequence, a pending label, a success toast and the refusal reason.
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { ConfirmActionButton } from "./confirm-action-button";
import { loanErrorKey } from "./exchange-error";

export function RecallLoanButton({
  loanId,
  puzzleTitle,
  borrowerName,
}: {
  loanId: string;
  puzzleTitle: string;
  borrowerName: string;
}) {
  const t = useTranslations("lending");
  const tCommon = useTranslations("common");
  const recallLoan = useMutation({
    mutationFn: useConvexMutation(gateway.lending.recallLoan),
  });

  const handleRecall = async (): Promise<boolean> => {
    try {
      await recallLoan.mutateAsync({ loanId });
      toast.success(
        t("toast.recalled", { title: puzzleTitle, name: borrowerName }),
      );
      return true;
    } catch (error) {
      toast.error(t(loanErrorKey(error)));
      return false;
    }
  };

  return (
    <ConfirmActionButton
      label={t("recallAction")}
      pendingLabel={t("recalling")}
      icon={Undo2}
      title={t("recallDialog.title", { title: puzzleTitle })}
      description={t("recallDialog.body", { name: borrowerName })}
      dismissLabel={tCommon("cancel")}
      pending={recallLoan.isPending}
      onConfirm={handleRecall}
    />
  );
}
