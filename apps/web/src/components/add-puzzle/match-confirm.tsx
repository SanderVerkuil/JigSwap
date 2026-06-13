// apps/web/src/components/add-puzzle/match-confirm.tsx
import type { ImportedMatch } from "@/components/puzzle-import/use-puzzle-import";
import { Button } from "@/components/ui/button";
import { useTranslations } from "use-intl";

export function MatchConfirm({
  match,
  onUse,
  onIgnore,
}: {
  match: ImportedMatch;
  onUse: () => void;
  onIgnore: () => void;
}) {
  const t = useTranslations("puzzles");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <span className="text-sm">
        {t("matchFoundLead")}{" "}
        <strong>
          {match.title}
          {match.brand ? ` · ${match.brand}` : ""} · {match.pieceCount}{" "}
          {t("pieces")}
        </strong>{" "}
        {t("matchFoundTail")}
      </span>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onUse}>
          {t("matchUseThis")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onIgnore}>
          {t("matchDifferent")}
        </Button>
      </div>
    </div>
  );
}
