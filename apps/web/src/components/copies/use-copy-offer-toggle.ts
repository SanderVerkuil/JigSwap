"use client";

import {
  hasAnyAvailability,
  type Availability,
} from "@/components/add-puzzle/add-puzzle-mappers";
import { copyEditFailureKey } from "@/components/copies/copy-edit-failure";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export type OfferFlag = "forTrade" | "forLend" | "forSale";

const CONFIRMATIONS: Record<
  OfferFlag,
  {
    on: "swapOn" | "lendOn" | "saleOn";
    off: "swapOff" | "lendOff" | "saleOff";
  }
> = {
  forTrade: { on: "swapOn", off: "swapOff" },
  forLend: { on: "lendOn", off: "lendOff" },
  forSale: { on: "saleOn", off: "saleOff" },
};

export interface OfferToggleTarget {
  /** The copy's domain id (aggregateId). */
  copyId: string;
  availability: Availability;
  /** The owner's own visibility choice, for the toast's note about a private copy. */
  visibilityPreference: "private" | "visible";
  /** The copy has an open loan: withdrawing still works, but no Undo would put it back on. */
  onLoan?: boolean;
}

// One copy's offer switched on or off, wherever that happens (the copy page's switches, a card's ⋯
// menu). It writes the offers ONLY, never a visibility, so the backend keeps the owner's own choice
// (a private copy is visible while offered and private again once every offer is withdrawn). Each
// change is confirmed with an Undo toast; failures toast an error and the live query keeps showing
// the stored state.
export function useCopyOfferToggle() {
  const t = useTranslations("copyInstance.offers");
  const tCopy = useTranslations("copyInstance");
  const update = useMutation({
    mutationFn: useConvexMutation(gateway.library.updateSharing),
  });
  // Refused while an exchange in progress reserves the copy or it is out on loan, or after too many
  // sharing changes in a minute: say so.
  const reportFailure = (error: unknown) => {
    toast.error(tCopy(copyEditFailureKey(error)));
  };

  // Undo can fire long after its change, even after this component unmounted: it sets only the offer
  // that changed, and the server keeps the others as they are by then, so Undo on an older toast
  // can't take back a later change. A skip is the server refusing this copy, for the same reasons.
  const writeOffer = useConvexMutation(gateway.library.updateOffers);
  const undo = async (copyId: string, flag: OfferFlag, on: boolean) => {
    try {
      const { skipped } = await writeOffer({
        copyIds: [copyId],
        [flag]: on,
      });
      const refusal = skipped[0]?.reason;
      if (refusal) {
        toast.error(
          tCopy(
            refusal === "notAllowed"
              ? "editCopy.editFailed"
              : "editCopy.copyReserved",
          ),
        );
      }
    } catch (error) {
      reportFailure(error);
    }
  };

  const toggle = async (
    { copyId, availability, visibilityPreference, onLoan }: OfferToggleTarget,
    flag: OfferFlag,
    on: boolean,
  ) => {
    const after = { ...availability, [flag]: on };
    try {
      // The offers only: no `visibility`, so updateCopySharing keeps the owner's stored choice.
      await update.mutateAsync({
        copyId,
        forTrade: after.forTrade,
        forLend: after.forLend,
        forSale: after.forSale,
      });
    } catch (error) {
      reportFailure(error);
      return;
    }
    const privateNote =
      visibilityPreference !== "private"
        ? undefined
        : hasAnyAvailability(after)
          ? t("visibleWhileOffered")
          : hasAnyAvailability(availability)
            ? t("privateAgain")
            : undefined;
    const confirmation = CONFIRMATIONS[flag];
    toast.success(t(on ? confirmation.on : confirmation.off), {
      ...(privateNote ? { description: privateNote } : {}),
      ...(onLoan
        ? {}
        : {
            action: {
              label: t("undo"),
              onClick: () => void undo(copyId, flag, !on),
            },
          }),
    });
  };

  return { toggle, pending: update.isPending };
}
