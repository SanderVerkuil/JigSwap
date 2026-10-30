// The lifecycle actions under an expanded exchange: Accept / Decline for the
// owner of a pending request, Cancel for its sender, Mark complete and Cancel
// for both members once accepted. Every action answers back: buttons are
// disabled with a "...ing" label while one runs, success and refusal both toast
// (refusal codes map to readable reasons via exchange-error), and the final
// ones (Decline, Cancel, Mark complete) sit behind a confirm that states the
// consequence. Completion
// needs both parties, so an accepted exchange also says who has confirmed:
// "You confirmed … · Waiting for …" replaces the button once the viewer has,
// and "Your turn" shows when only the partner has (the viewer's click then
// settles it). `children` are the trailing actions that don't change the
// exchange (review, message, report).
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useConvexMutation } from "@convex-dev/react-query";
import type { ExchangeFields } from "@jigswap/contracts";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { ConfirmActionButton } from "./confirm-action-button";
import { exchangeErrorKey } from "./exchange-error";
import { YourTurnPill } from "./exchange-pills";
import {
  confirmationState,
  viewerSide,
  type Direction,
  type ExchangeSide,
} from "./exchange-state";

export type ActionableExchange = Pick<
  ExchangeFields,
  | "aggregateId"
  | "status"
  | "type"
  | "initiatorConfirmationTimestamp"
  | "recipientConfirmationTimestamp"
>;

export function ExchangeActions({
  exchange,
  direction,
  partnerName,
  requestedTitle,
  offeredTitle,
  children,
}: {
  exchange: ActionableExchange;
  direction: Direction;
  partnerName: string;
  /** The requested copy's title (the recipient's puzzle). */
  requestedTitle?: string;
  /** The offered copy's title (the initiator's puzzle in a swap). */
  offeredTitle?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("trades");
  const tCommon = useTranslations("common");
  const relativeTime = useRelativeTime();

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
  const side = viewerSide(direction);
  const { mineAt, theirsAt, mySettles } = confirmationState(exchange, side);
  const untitled = t("completeConfirm.untitled");
  const completeBody = [
    mySettles
      ? t("completeConfirm.leadSettles", { name: partnerName })
      : t("completeConfirm.leadFirst", { name: partnerName }),
    completionEffect(t, exchange.type, side, {
      name: partnerName,
      requested: requestedTitle ?? untitled,
      offered: offeredTitle ?? untitled,
    }),
    // A swap or sale moves ownership for good; a loan ends with a return.
    ...(exchange.type === "loan" ? [] : [t("completeConfirm.irreversible")]),
  ].join(" ");
  const completeSuccess = !mySettles
    ? t("toast.confirmedWaiting", { name: partnerName })
    : exchange.type === "loan"
      ? t("toast.loanStarted")
      : t("toast.completed");

  return (
    <div className="flex flex-col gap-2">
      {exchange.status === "accepted" && mineAt !== undefined && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          {t("confirmation.waiting", {
            when: relativeTime(mineAt),
            name: partnerName,
          })}
        </p>
      )}
      {exchange.status === "accepted" &&
        mySettles &&
        theirsAt !== undefined && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <YourTurnPill />
            <span className="text-muted-foreground">
              {t("confirmation.partnerConfirmed", {
                name: partnerName,
                when: relativeTime(theirsAt),
              })}
            </span>
          </p>
        )}
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

        {exchange.status === "accepted" && mineAt === undefined && (
          <ConfirmActionButton
            label={t("markComplete")}
            pendingLabel={t("pendingLabel.complete")}
            icon={CheckCircle}
            variant="default"
            title={t("completeConfirm.title")}
            description={completeBody}
            confirmLabel={t("completeConfirm.confirm")}
            dismissLabel={tCommon("cancel")}
            pending={complete.isPending}
            disabled={!exchangeId || busy}
            onConfirm={() => run(complete, completeSuccess)}
          />
        )}

        {/* Accepting sets the puzzle aside for this one exchange, so either side can call it off,
            also after confirming their own handover (a pending request is only the requester's to
            cancel). */}
        {exchange.status === "accepted" && (
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
        )}

        {children}
      </div>
    </div>
  );
}

// What completing does, from the viewer's side: a swap moves the requested
// copy to the initiator and the offered copy to the recipient; a sale moves the
// requested copy to the initiator; a loan moves possession only.
function completionEffect(
  t: (key: string, values: Record<string, string>) => string,
  type: ActionableExchange["type"],
  side: ExchangeSide,
  {
    name,
    requested,
    offered,
  }: { name: string; requested: string; offered: string },
): string {
  const owner = side === "recipient";
  switch (type) {
    case "trade":
      return t("completeConfirm.effect.trade", {
        name,
        give: owner ? requested : offered,
        get: owner ? offered : requested,
      });
    case "sale":
      return owner
        ? t("completeConfirm.effect.saleGive", { name, title: requested })
        : t("completeConfirm.effect.saleGet", { title: requested });
    case "loan":
      return owner
        ? t("completeConfirm.effect.loanLend", { name, title: requested })
        : t("completeConfirm.effect.loanBorrow", { name, title: requested });
  }
}
