// apps/web/src/components/add-puzzle/match-confirm.tsx
import type { ImportedMatch } from "@/components/puzzle-import/use-puzzle-import";
import { Button } from "@/components/ui/button";

export function MatchConfirm({
  match,
  onUse,
  onIgnore,
}: {
  match: ImportedMatch;
  onUse: () => void;
  onIgnore: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <span className="text-sm">
        We found{" "}
        <strong>
          {match.title}
          {match.brand ? ` · ${match.brand}` : ""} · {match.pieceCount} pieces
        </strong>{" "}
        already — is this the same puzzle?
      </span>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={onUse}>
          Use this one
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onIgnore}>
          No, it&apos;s different
        </Button>
      </div>
    </div>
  );
}
