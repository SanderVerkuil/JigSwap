import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Check, Plus, Search, X } from "lucide-react";
import { useId } from "react";
import { useTranslations } from "use-intl";
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
  picks: Pick[];
  isSearching: boolean;
  isSubmitting: boolean;
  // Where "Register" sends the member back to after creating the puzzle.
  returnTo?: string;
  onTermChange: (term: string) => void;
  onToggle: (row: PickerRow) => void;
  onRemove: (definitionId: string) => void;
  onRemoveLast: () => void;
  onForTradeChange: (definitionId: string, forTrade: boolean) => void;
  onSubmit: () => void;
}

// The multi-select catalogue picker, without data fetching (CataloguePicker wires it). Each result
// row is an aria-pressed toggle; picks collect in a tray where each can be offered for swap or
// removed; one submit adds them all.
export function CataloguePickerView({
  term,
  rows,
  picks,
  isSearching,
  isSubmitting,
  returnTo,
  onTermChange,
  onToggle,
  onRemove,
  onRemoveLast,
  onForTradeChange,
  onSubmit,
}: CataloguePickerViewProps) {
  const t = useTranslations("cataloguePicker");
  const tp = useTranslations("puzzles");
  const searchId = useId();
  const trayHeadingId = useId();
  const trimmed = term.trim();
  const full = picks.length >= PICK_LIMIT;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="sr-only">
          {t("searchLabel")}
        </label>
        <div className="relative">
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
        {!trimmed && rows.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("searchHint")}</p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {t("picked", { count: picks.length })}
      </p>

      {rows.length > 0 && (
        <ul className="divide-border flex flex-col divide-y rounded-xl border">
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
                        row.pieceCount && `${row.pieceCount} ${tp("pieces")}`,
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
                      className="text-jigsaw-primary dark:text-foreground size-5 shrink-0"
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
          {t("noResults", { query: trimmed })}
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

      {picks.length > 0 && (
        <section
          aria-labelledby={trayHeadingId}
          className="flex flex-col gap-2"
        >
          <h3 id={trayHeadingId} className="text-sm font-semibold">
            {t("pickedHeading", { count: picks.length })}
          </h3>
          <ul className="divide-border flex flex-col divide-y border-y">
            {picks.map((p) => (
              <li
                key={p.definitionId}
                className="flex min-h-11 items-center gap-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {p.title}
                </span>
                {p.pending && (
                  <Badge variant="secondary">{tp("pendingReview")}</Badge>
                )}
                <span className="flex items-center gap-2">
                  <span aria-hidden className="text-muted-foreground text-xs">
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

      <p className="text-muted-foreground text-xs">{t("availabilityNote")}</p>

      <div className="flex justify-end">
        <Button
          type="button"
          data-picker-submit
          className="bg-jigsaw-primary hover:bg-jigsaw-primary/90 w-full text-white pointer-coarse:min-h-11 sm:w-auto"
          disabled={picks.length === 0 || isSubmitting}
          onClick={onSubmit}
        >
          {t("submit", { count: picks.length })}
        </Button>
      </div>
    </div>
  );
}
