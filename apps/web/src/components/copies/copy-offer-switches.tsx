"use client";

import type { Availability } from "@/components/add-puzzle/add-puzzle-mappers";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { useCopyOfferToggle, type OfferFlag } from "./use-copy-offer-toggle";

const OFFERS: ReadonlyArray<{
  flag: OfferFlag;
  label: "swapLabel" | "lendLabel" | "saleLabel";
  hint: "swapHint" | "lendHint" | "saleHint";
}> = [
  { flag: "forTrade", label: "swapLabel", hint: "swapHint" },
  { flag: "forLend", label: "lendLabel", hint: "lendHint" },
  { flag: "forSale", label: "saleLabel", hint: "saleHint" },
];

// The copy page's offer controls for whoever may manage the copy: one labelled switch per offer.
// Sale isn't offered as a new choice here (the Edit dialog is where a copy goes up for sale), but a
// copy on offer for sale gets its switch, so the status line's offer can be withdrawn from where the
// others are; it stays once off, so the Undo has a visible home and focus isn't dropped. A flip writes the offers ONLY, never a visibility, so the backend keeps the owner's own choice
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
  onSendLink,
}: {
  /** The copy's domain id (aggregateId); null for legacy rows, which can't be changed here. */
  copyId: string | null;
  availability: Availability;
  /** The owner's own visibility choice (CopyInstanceView visibilityPreference ?? visibility). */
  visibilityPreference: "private" | "visible";
  /** The copy has an open loan (CopyInstanceView loans: status "open"). */
  onLoan?: boolean;
  /** Opens "Send a link"; turning an offer on offers it right away in the toast. */
  onSendLink?: () => void;
}) {
  const t = useTranslations("copyInstance.offers");
  const id = useId();
  const [saleShown, setSaleShown] = useState(availability.forSale);
  if (availability.forSale && !saleShown) setSaleShown(true);
  const { toggle, pending } = useCopyOfferToggle();

  const change = (flag: OfferFlag, on: boolean) => {
    if (copyId == null) return;
    return toggle(
      { copyId, availability, visibilityPreference, onLoan, onSendLink },
      flag,
      on,
    );
  };

  return (
    <div className="border-border bg-card divide-border max-w-md divide-y rounded-lg border">
      {OFFERS.filter(({ flag }) => flag !== "forSale" || saleShown).map(
        ({ flag, label, hint }) => {
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
                disabled={copyId == null || locked || pending}
                aria-describedby={
                  locked
                    ? `${id}-${flag}-hint ${id}-locked`
                    : `${id}-${flag}-hint`
                }
                onCheckedChange={(on) => void change(flag, on)}
              />
            </div>
          );
        },
      )}
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
