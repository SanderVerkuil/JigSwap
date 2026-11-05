// "Return" on a borrowed copy: the borrower closes the loan once the lender
// has the puzzle back. Behind a confirm (closing a loan can't be undone), with
// a pending label, a success toast, and the refusal reason on failure.
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { ConfirmActionButton } from "./confirm-action-button";
import { loanErrorKey } from "./exchange-error";

export function ReturnLoanButton({
  loanId,
  puzzleTitle,
  lenderName,
  variant,
}: {
  loanId: string;
  puzzleTitle: string;
  lenderName: string;
  variant?: ComponentProps<typeof ConfirmActionButton>["variant"];
}) {
  const t = useTranslations("lending");
  const tCommon = useTranslations("common");
  const returnLoan = useMutation({
    mutationFn: useConvexMutation(gateway.lending.returnLoan),
  });

  const handleReturn = async (): Promise<boolean> => {
    try {
      await returnLoan.mutateAsync({ loanId });
      toast.success(
        t("toast.returned", { title: puzzleTitle, name: lenderName }),
      );
      return true;
    } catch (error) {
      toast.error(t(loanErrorKey(error)));
      return false;
    }
  };

  return (
    <ConfirmActionButton
      label={t("returnAction")}
      pendingLabel={t("returning")}
      title={t("returnConfirm.title", { title: puzzleTitle })}
      description={t("returnConfirm.body", { name: lenderName })}
      dismissLabel={tCommon("cancel")}
      variant={variant}
      pending={returnLoan.isPending}
      onConfirm={handleReturn}
    />
  );
}
