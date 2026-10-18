"use client";

// The exchange detail's overflow menu: "Report member" files a report about
// the trade partner's behaviour (targetKind "exchange"). A dispute is about
// the trade itself; a report is about the member, so the two stay separate.
import { ReportDialog } from "@/components/safety/report-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/gateway";
import { Flag, MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";

export function ExchangeReportMenu({
  exchangeId,
  partnerId,
  partnerName,
}: {
  /** The exchange's aggregateId (or legacy _id). */
  exchangeId: string;
  partnerId?: Id<"users">;
  partnerName: string;
}) {
  const t = useTranslations("safety");
  const [reporting, setReporting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className="ml-auto size-11 shrink-0 md:size-8"
            aria-label={t("exchangeActions")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11 md:min-h-0"
            onSelect={() => setReporting(true)}
          >
            <Flag aria-hidden />
            {t("reportMember")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog
        target={{ kind: "exchange", id: exchangeId }}
        name={partnerName}
        memberId={partnerId}
        open={reporting}
        onOpenChange={setReporting}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
