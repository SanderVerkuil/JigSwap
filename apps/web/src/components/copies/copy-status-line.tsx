"use client";

import type { Availability } from "@/components/add-puzzle/add-puzzle-mappers";
import { cn } from "@/lib/utils";
import { ArrowLeftRight, Globe, Lock, Package } from "lucide-react";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { RecallLoanButton } from "./recall-loan-button";

/** The copy's open loan, as the copy page knows it. */
export interface OpenLoan {
  borrowerName: string;
  openedAt: number;
  /** The loan's domain id from lending.lentOut; null while unknown (no Recall then). */
  loanId: string | null;
}

const OFFER_WORDS = [
  ["forTrade", "offerSwap"],
  ["forLend", "offerLend"],
  ["forSale", "offerSale"],
] as const;

// The one line under a copy's title that says where it is and who can see it, replacing the
// cover's "Available" chip and the For Trade/Lend/Sale badges. For whoever manages the copy
// (`detailed`): an open loan ("On loan to Anna since 3 Mar 2026 · Recall"), otherwise the offers
// plus who can see it, from the owner's own choice (`visibilityPreference`): visible to the
// community, visible only while offered, or private. Visitors only see what it is offered for,
// and nothing when it isn't offered.
export function CopyStatusLine({
  detailed,
  availability,
  visibilityPreference,
  openLoan,
}: {
  detailed: boolean;
  availability: Availability;
  visibilityPreference: "private" | "visible";
  openLoan: OpenLoan | null;
}) {
  const t = useTranslations("copyInstance.status");
  const tVisibility = useTranslations("copyInstance.editCopy.visibility");
  const format = useFormatter();

  const offers = OFFER_WORDS.filter(([flag]) => availability[flag]).map(
    ([, word]) => t(word),
  );
  const offered =
    offers.length > 0 ? t("offered", { offers: format.list(offers) }) : null;

  let icon: ReactNode;
  let parts: string[];
  let tone = "text-muted-foreground";
  if (detailed && openLoan) {
    icon = <Package />;
    tone = "text-amber-700 dark:text-amber-300";
    parts = [
      t("onLoan", {
        name: openLoan.borrowerName,
        date: format.dateTime(new Date(openLoan.openedAt), {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      }),
    ];
  } else if (offered) {
    icon = <ArrowLeftRight />;
    tone = "text-jigsaw-secondary";
    parts = detailed
      ? [
          offered,
          visibilityPreference === "private"
            ? t("visibleWhileOffered")
            : tVisibility("visible"),
        ]
      : [offered];
  } else if (detailed) {
    icon = visibilityPreference === "private" ? <Lock /> : <Globe />;
    parts =
      visibilityPreference === "private"
        ? [tVisibility("private")]
        : [t("notOffered"), tVisibility("visible")];
  } else {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p
        data-testid="copy-status-line"
        className="text-foreground flex items-center gap-2 text-sm font-medium"
      >
        <span
          aria-hidden
          className={cn("inline-flex shrink-0 [&_svg]:size-4", tone)}
        >
          {icon}
        </span>
        <span>{parts.join(" · ")}</span>
      </p>
      {detailed && openLoan?.loanId && (
        <RecallLoanButton
          loanId={openLoan.loanId}
          borrowerName={openLoan.borrowerName}
        />
      )}
    </div>
  );
}
