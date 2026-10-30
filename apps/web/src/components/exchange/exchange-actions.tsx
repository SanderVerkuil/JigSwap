// The lifecycle actions under an expanded exchange: Accept / Decline for the
// owner of a pending request, Cancel for its sender, Mark complete and Cancel
// for both members once accepted. Every action answers back: buttons are disabled with a "...ing"
// label while one runs, success and refusal both toast (refusal codes map to
// readable reasons via exchange-error), and the final ones (Decline, Cancel)
// sit behind a confirm that states the consequence. `children` are the
// trailing actions that don't change the exchange (review, message, report).
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import type { ExchangeFields } from "@jigswap/contracts";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { ConfirmActionButton } from "./confirm-action-button";
import { exchangeErrorKey } from "./exchange-error";

export type ActionableExchange = Pick<ExchangeFields, "aggregateId" | "status">;

export function ExchangeActions({
  exchange,
  direction,
  partnerName,
  children,
}: {
  exchange: ActionableExchange;
  direction: "incoming" | "outgoing";
  partnerName: string;
  children?: ReactNode;
}) {
  const t = useTranslations("trades");
  const tCommon = useTranslations("common");

  const accept = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.accept),
  });
  const decline = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.decline),
  });
  const cancel = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.cancel),
  });
  const complete = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.complete),
  });

  const busy =
    accept.isPending ||
    decline.isPending ||
    cancel.isPending ||
    complete.isPending;

  // The lifecycle mutations key off the domain aggregateId, not the Convex _id;
  // a legacy row without one can't be acted on, so its buttons stay disabled.
  const exchangeId = exchange.aggregateId;
  const run = async (
    mutation: {
      mutateAsync: (args: { exchangeId: string }) => Promise<unknown>;
    },
    success: string,
  ): Promise<boolean> => {
    if (!exchangeId) return false;
    try {
      await mutation.mutateAsync({ exchangeId });
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(t(exchangeErrorKey(error)));
      return false;
    }
  };

  const incoming = direction === "incoming";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {exchange.status === "proposed" && incoming && (
        <>
          <Button
            size="sm"
            disabled={!exchangeId || busy}
            onClick={() =>
              void run(accept, t("toast.accepted", { name: partnerName }))
            }
          >
            <CheckCircle className="h-4 w-4" />
            {accept.isPending ? t("pendingLabel.accept") : t("accept")}
          </Button>
          <ConfirmActionButton
            label={t("decline")}
            pendingLabel={t("pendingLabel.decline")}
            icon={XCircle}
            title={t("declineConfirm.title")}
            description={t("declineConfirm.body", { name: partnerName })}
            dismissLabel={tCommon("cancel")}
            destructive
            pending={decline.isPending}
            disabled={!exchangeId || busy}
            onConfirm={() => run(decline, t("toast.declined"))}
          />
        </>
      )}

      {exchange.status === "proposed" && !incoming && (
        <ConfirmActionButton
          label={t("cancel")}
          pendingLabel={t("pendingLabel.cancel")}
          icon={XCircle}
          title={t("cancelConfirm.title")}
          description={t("cancelConfirm.body", { name: partnerName })}
          confirmLabel={t("cancelConfirm.confirm")}
          dismissLabel={t("cancelConfirm.keep")}
          destructive
          pending={cancel.isPending}
          disabled={!exchangeId || busy}
          onConfirm={() => run(cancel, t("toast.cancelled"))}
        />
      )}

      {exchange.status === "accepted" && (
        <>
          <Button
            size="sm"
            disabled={!exchangeId || busy}
            onClick={() => void run(complete, t("toast.confirmed"))}
          >
            <CheckCircle className="h-4 w-4" />
            {complete.isPending
              ? t("pendingLabel.complete")
              : t("markComplete")}
          </Button>
          {/* Accepting sets the puzzle aside for this one exchange, so either side can call it
              off (a pending request is only the requester's to cancel). */}
          <ConfirmActionButton
            label={t("cancel")}
            pendingLabel={t("pendingLabel.cancel")}
            icon={XCircle}
            title={t("cancelAccepted.title")}
            description={t("cancelAccepted.body")}
            confirmLabel={t("cancelAccepted.confirm")}
            dismissLabel={t("cancelAccepted.keep")}
            destructive
            pending={cancel.isPending}
            disabled={!exchangeId || busy}
            onConfirm={() => run(cancel, t("toast.cancelledAccepted"))}
          />
        </>
      )}

      {children}
    </div>
  );
}
