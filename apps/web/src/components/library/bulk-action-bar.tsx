"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeftRight,
  ChevronDown,
  CircleOff,
  FolderPlus,
  Package,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { useTranslations } from "use-intl";
import type { BulkOfferAction } from "./bulk-selection";

const OFFER_ACTIONS: ReadonlyArray<{
  action: BulkOfferAction;
  Icon: LucideIcon;
}> = [
  { action: "offerSwap", Icon: ArrowLeftRight },
  { action: "offerLend", Icon: Package },
  { action: "withdraw", Icon: CircleOff },
];

// My Puzzles' selection bar: how many puzzles are selected, Select all / Clear, and what can be done
// to them (Offer for swap, Offer to lend, Withdraw offers, Add to collection). It sticks to the
// bottom of the list: on a phone just above the tab bar (clearing its raised "+"), from md up as a
// floating bar. Where the bar is narrow (phones, tablets beside the sidebar) the three offer actions
// share one "Offers" menu so every action stays on screen without wrapping.
export function BulkActionBar({
  selectedCount,
  selectableCount,
  busy = false,
  onSelectAll,
  onClear,
  onExit,
  onOffer,
  onAddToCollection,
}: {
  selectedCount: number;
  // The copies on screen that can be selected (what Select all selects).
  selectableCount: number;
  // An action is running: actions are disabled until it has finished.
  busy?: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  onOffer: (action: BulkOfferAction) => void;
  onAddToCollection: () => void;
}) {
  const t = useTranslations("puzzles.bulk");
  const disabled = selectedCount === 0 || busy;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;

  return (
    <div
      role="region"
      aria-label={t("barLabel")}
      aria-busy={busy}
      className="bg-card @container sticky bottom-14 z-20 -mx-4 border-t px-4 pt-3 pb-[30px] md:bottom-4 md:mx-0 md:rounded-xl md:border md:pb-3 md:shadow-lg"
    >
      <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("exit")}
            onClick={onExit}
            className="-ml-2 pointer-coarse:size-11"
          >
            <X aria-hidden />
          </Button>
          <span
            aria-live="polite"
            className="min-w-0 flex-1 truncate text-sm font-medium"
          >
            {t("selectedCount", { count: selectedCount })}
          </span>
          {allSelected ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="pointer-coarse:min-h-11"
            >
              {t("clear")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
              disabled={selectableCount === 0}
              className="pointer-coarse:min-h-11"
            >
              {t("selectAll", { count: selectableCount })}
            </Button>
          )}
        </div>

        {/* Narrow bar: the offer actions in one menu, beside Add to collection. */}
        <div
          data-testid="bulk-actions-compact"
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 @2xl:hidden"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="pointer-coarse:min-h-11"
              >
                {t("offers")}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {OFFER_ACTIONS.map(({ action, Icon }) => (
                <Fragment key={action}>
                  {action === "withdraw" && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={() => onOffer(action)}>
                    <Icon className="mr-2 size-4 shrink-0" aria-hidden />
                    {t(action)}
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onAddToCollection}
            // Takes what's left beside Offers and wraps rather than overflow (Dutch on a small phone).
            className="h-auto min-h-9 whitespace-normal pointer-coarse:min-h-11"
          >
            <FolderPlus aria-hidden />
            {t("addToCollection")}
          </Button>
        </div>

        {/* Wide bar: every action is its own button. */}
        <div
          data-testid="bulk-actions-inline"
          className="hidden items-center gap-2 @2xl:flex"
        >
          {OFFER_ACTIONS.map(({ action, Icon }) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onOffer(action)}
            >
              <Icon aria-hidden />
              {t(action)}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onAddToCollection}
          >
            <FolderPlus aria-hidden />
            {t("addToCollection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
