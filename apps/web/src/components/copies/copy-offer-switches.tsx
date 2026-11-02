"use client";

import {
  hasAnyAvailability,
  type Availability,
} from "@/components/add-puzzle/add-puzzle-mappers";
import { convexErrorCode } from "@/components/exchange/request-trade";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type OfferFlag = "forTrade" | "forLend";

const OFFERS: ReadonlyArray<{
  flag: OfferFlag;
  label: "swapLabel" | "lendLabel";
  hint: "swapHint" | "lendHint";
  on: "swapOn" | "lendOn";
  off: "swapOff" | "lendOff";
}> = [
  {
    flag: "forTrade",
    label: "swapLabel",
    hint: "swapHint",
    on: "swapOn",
    off: "swapOff",
  },
  {
    flag: "forLend",
    label: "lendLabel",
    hint: "lendHint",
    on: "lendOn",
    off: "lendOff",
  },
];

// The copy page's offer controls for whoever may manage the copy: one labelled switch per offer.
// A flip writes the offers ONLY, never a visibility, so the backend keeps the owner's own choice
// (a private copy is visible while offered and private again once every offer is withdrawn).
// Each change is confirmed with an Undo toast; failures toast an error and the live query keeps
// showing the stored state. While the copy is out on loan a switch that is off is disabled with the
// reason: lending it out withdrew its offers, and it can't be offered until it is back. One that is
// on can still be withdrawn, without an Undo, which would put it back on.
export function CopyOfferSwitches({
  copyId,
  availability,
  visibilityPreference,
  onLoan = false,
}: {
  /** The copy's domain id (aggregateId); null for legacy rows, which can't be changed here. */
  copyId: string | null;
  availability: Availability;
  /** The owner's own visibility choice (CopyInstanceView visibilityPreference ?? visibility). */
  visibilityPreference: "private" | "visible";
  /** The copy has an open loan (CopyInstanceView loans: status "open"). */
  onLoan?: boolean;
}) {
  const t = useTranslations("copyInstance.offers");
  const tCopy = useTranslations("copyInstance");
  const id = useId();
  // The raw mutation for Undo, which can fire after this component has re-rendered or unmounted.
  const writeOffers = useConvexMutation(gateway.library.updateSharing);
  const update = useMutation({ mutationFn: writeOffers });

  // The offers only: no `visibility`, so updateCopySharing keeps the owner's stored choice.
  const offersArgs = (aggregateId: string, offers: Availability) => ({
    copyId: aggregateId,
    forTrade: offers.forTrade,
    forLend: offers.forLend,
    forSale: offers.forSale,
  });

  // Refused while an exchange in progress reserves the copy or it is out on loan: say so.
  const reportFailure = (error: unknown) => {
    toast.error(
      tCopy(
        convexErrorCode(error) === "CopyReserved"
          ? "editCopy.copyReserved"
          : "editCopy.editFailed",
      ),
    );
  };

  const change = async (flag: OfferFlag, on: boolean) => {
    if (copyId == null) return;
    const before = availability;
    const after = { ...availability, [flag]: on };
    const offer = OFFERS.find((o) => o.flag === flag)!;
    try {
      await update.mutateAsync(offersArgs(copyId, after));
    } catch (error) {
      reportFailure(error);
      return;
    }
    const privateNote =
      visibilityPreference !== "private"
        ? undefined
        : hasAnyAvailability(after)
          ? t("visibleWhileOffered")
          : hasAnyAvailability(before)
            ? t("privateAgain")
            : undefined;
    toast.success(t(on ? offer.on : offer.off), {
      ...(privateNote ? { description: privateNote } : {}),
      ...(onLoan
        ? {}
        : {
            action: {
              label: t("undo"),
              onClick: () => {
                writeOffers(offersArgs(copyId, before)).catch(reportFailure);
              },
            },
          }),
    });
  };

  return (
    <div className="border-border bg-card divide-border max-w-md divide-y rounded-lg border">
      {OFFERS.map(({ flag, label, hint }) => {
        const locked = onLoan && !availability[flag];
        return (
          <div
            key={flag}
            className="flex min-h-14 items-center justify-between gap-4 px-4 py-2.5"
          >
            <div className="min-w-0">
              <Label
                htmlFor={`${id}-${flag}`}
                className="text-sm font-semibold"
              >
                {t(label)}
              </Label>
              <p
                id={`${id}-${flag}-hint`}
                className="text-muted-foreground mt-0.5 text-xs"
              >
                {t(hint)}
              </p>
            </div>
            <Switch
              id={`${id}-${flag}`}
              checked={availability[flag]}
              disabled={copyId == null || locked || update.isPending}
              aria-describedby={
                locked
                  ? `${id}-${flag}-hint ${id}-locked`
                  : `${id}-${flag}-hint`
              }
              onCheckedChange={(on) => void change(flag, on)}
            />
          </div>
        );
      })}
      {onLoan && (
        <p
          id={`${id}-locked`}
          className="text-muted-foreground px-4 py-2.5 text-xs"
        >
          {t("lockedOnLoan")}
        </p>
      )}
    </div>
  );
}
