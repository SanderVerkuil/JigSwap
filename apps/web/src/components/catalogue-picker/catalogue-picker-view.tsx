import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useReportSurfaceBusy } from "@/components/whats-new/surface-busy";
import { isPartialBarcode } from "@/lib/catalogue-search";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, ChevronUp, Plus, Search, X } from "lucide-react";
import { useId, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { BarcodeScanButton } from "./barcode-scan-button";
import {
  isPicked,
  PICK_LIMIT,
  registerSearch,
  type Pick,
  type PickerRow,
} from "./selection";

export interface CataloguePickerViewProps {
  term: string;
  rows: PickerRow[];
  picks: readonly Pick[];
  isSearching: boolean;
  isSubmitting: boolean;
  // Where "Register" sends the member back to after creating the puzzle.
  returnTo?: string;
  // Phones: once something is picked, dock the submit above the tab bar with a "Picked (n)" chip
  // that opens the tray, so neither drifts below a growing results list. Opt-in, because
  // /welcome wraps the picker in its own sticky flow footer.
  stickyFooter?: boolean;
  // Inside quick setup the flow's Continue adds the picks ("Add 3 and continue"), so the picker
  // shows no submit of its own.
  hideSubmit?: boolean;
  onTermChange: (term: string) => void;
  onToggle: (row: PickerRow) => void;
  onRemove: (definitionId: string) => void;
  onRemoveLast: () => void;
  onForTradeChange: (definitionId: string, forTrade: boolean) => void;
  onForLendChange: (definitionId: string, forLend: boolean) => void;
  onSubmit: () => void;
}

// The multi-select catalogue picker, without data fetching (CataloguePicker wires it). Each result
// row is an aria-pressed toggle; picks collect in a tray where each can be offered for swap, offered
// to lend or removed; one submit adds them all.
export function CataloguePickerView({
  term,
  rows,
  picks,
  isSearching,
  isSubmitting,
  returnTo,
  stickyFooter = false,
  hideSubmit = false,
  onTermChange,
  onToggle,
  onRemove,
  onRemoveLast,
  onForTradeChange,
  onForLendChange,
  onSubmit,
}: CataloguePickerViewProps) {
  const t = useTranslations("cataloguePicker");
  const tp = useTranslations("puzzles");
  const format = useFormatter();
  const searchId = useId();
  const trayHeadingId = useId();
  const trayId = useId();
  const [trayOpen, setTrayOpen] = useState(false);
  const trimmed = term.trim();
  const full = picks.length >= PICK_LIMIT;
  const docked = stickyFooter && picks.length > 0;
  // The install tip docks in the same spot: while the submit is docked, it steps aside.
  useReportSurfaceBusy("cataloguePicker", docked);
  // Docked on a phone, the tray and its note only show when the chip opens them.
  const hiddenWhenDocked = docked && !trayOpen && "max-sm:hidden";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="sr-only">
          {t("searchLabel")}
        </label>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              id={searchId}
              type="search"
              autoComplete="off"
              placeholder={t("searchPlaceholder")}
              value={term}
              onChange={(e) => onTermChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && term === "" && picks.length > 0) {
                  onRemoveLast();
                }
              }}
              className="pl-9"
            />
          </div>
          <BarcodeScanButton onScan={onTermChange} />
        </div>
        {!trimmed && rows.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("searchHint")}</p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {t("picked", { count: picks.length })}
      </p>

      {rows.length > 0 && (
        <ul className="divide-border flex flex-col divide-y overflow-hidden rounded-xl border">
          {rows.map((row) => {
            const picked = isPicked(picks, row.definitionId);
            return (
              <li key={row.definitionId}>
                <button
                  type="button"
                  aria-pressed={picked}
                  aria-label={t(picked ? "remove" : "add", {
                    title: row.title,
                  })}
                  disabled={!picked && full}
                  onClick={() => onToggle(row)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
                    picked
                      ? "bg-jigsaw-primary-tint text-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="bg-muted size-10 shrink-0 overflow-hidden rounded-md">
                    {row.image && (
                      <img
                        src={row.image}
                        srcSet={row.imageSrcSet}
                        sizes={row.imageSrcSet ? "40px" : undefined}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {row.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {[
                        row.brand,
                        row.pieceCount &&
                          `${format.number(row.pieceCount)} ${tp("pieces", { count: row.pieceCount })}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {row.pending && (
                    <Badge variant="secondary">{tp("pendingReview")}</Badge>
                  )}
                  {row.onShelf && (
                    <Badge variant="outline">{t("onShelf")}</Badge>
                  )}
                  {picked ? (
                    <Check
                      aria-hidden
                      className="text-primary-text size-5 shrink-0"
                    />
                  ) : (
                    <Plus
                      aria-hidden
                      className="text-muted-foreground size-5 shrink-0"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {trimmed && rows.length === 0 && !isSearching && (
        <p className="text-muted-foreground text-sm">
          {isPartialBarcode(trimmed)
            ? `${t("keepTypingBarcode")} ${t("barcodeLength")}`
            : t("noResults", { query: trimmed })}
        </p>
      )}

      {full && (
        <p className="text-muted-foreground text-xs">
          {t("limitReached", { max: PICK_LIMIT })}
        </p>
      )}

      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground text-sm">{t("notListed")}</p>
        <Button variant="outline" className="pointer-coarse:min-h-11" asChild>
          <Link
            to="/my-puzzles/add/new"
            search={{ puzzleId: undefined, ...registerSearch(term, returnTo) }}
          >
            <Plus aria-hidden className="size-4" />
            {trimmed ? t("register", { query: trimmed }) : t("registerNew")}
          </Link>
        </Button>
      </div>

      <div
        data-picker-footer
        className={cn(
          "flex flex-col gap-5",
          // Sticky just above the tab bar (bottom-14, as the quick-start flow footer); the bottom
          // padding clears the tab bar's raised "+" button. Bleeds to the screen edges.
          docked &&
            "max-sm:bg-card max-sm:sticky max-sm:bottom-14 max-sm:z-20 max-sm:-mx-4 max-sm:gap-3 max-sm:border-t max-sm:px-4 max-sm:pt-3 max-sm:pb-[30px]",
        )}
      >
        {picks.length > 0 && (
          <section
            id={trayId}
            aria-labelledby={trayHeadingId}
            className={cn(
              "flex flex-col gap-2",
              docked && "max-sm:max-h-[45vh] max-sm:overflow-y-auto",
              hiddenWhenDocked,
            )}
          >
            <h3 id={trayHeadingId} className="text-sm font-semibold">
              {t("pickedHeading", { count: picks.length })}
            </h3>
            <ul className="divide-border flex flex-col divide-y border-y">
              {picks.map((p) => (
                // On a phone the offers take a line of their own, so the title keeps its room.
                <li
                  key={p.definitionId}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.title}
                  </span>
                  {p.pending && (
                    <Badge variant="secondary">{tp("pendingReview")}</Badge>
                  )}
                  <span className="flex items-center gap-3 max-sm:order-last max-sm:w-full">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="text-muted-foreground text-xs"
                      >
                        {t("forTrade")}
                      </span>
                      <Switch
                        checked={p.forTrade}
                        onCheckedChange={(checked) =>
                          onForTradeChange(p.definitionId, checked)
                        }
                        aria-label={t("forTradeLabel", { title: p.title })}
                      />
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="text-muted-foreground text-xs"
                      >
                        {t("forLend")}
                      </span>
                      <Switch
                        checked={p.forLend}
                        onCheckedChange={(checked) =>
                          onForLendChange(p.definitionId, checked)
                        }
                        aria-label={t("forLendLabel", { title: p.title })}
                      />
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 pointer-coarse:size-11"
                    aria-label={t("remove", { title: p.title })}
                    onClick={() => onRemove(p.definitionId)}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className={cn("text-muted-foreground text-xs", hiddenWhenDocked)}>
          {t("availabilityNote")}
        </p>

        {/* Only once something is picked, so never a disabled "Add 0 puzzles". */}
        {!hideSubmit && picks.length > 0 && (
          <div className="flex items-center justify-end gap-3">
            {docked && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0 pointer-coarse:min-h-11 sm:hidden"
                aria-expanded={trayOpen}
                aria-controls={trayId}
                onClick={() => setTrayOpen((open) => !open)}
              >
                {t("pickedHeading", { count: picks.length })}
                <ChevronUp
                  aria-hidden
                  className={cn(
                    "transition-transform motion-reduce:transition-none",
                    trayOpen && "rotate-180",
                  )}
                />
              </Button>
            )}
            <Button
              type="button"
              data-picker-submit
              className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 w-full min-w-0 flex-1 text-white pointer-coarse:min-h-11 sm:w-auto sm:flex-none"
              disabled={isSubmitting}
              onClick={onSubmit}
            >
              {t("submit", { count: picks.length })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
