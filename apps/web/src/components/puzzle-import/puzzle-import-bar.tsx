import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { ImportedDraft } from "./draft-to-form-defaults";
import { type ImportedMatch, usePuzzleImport } from "./use-puzzle-import";

interface PuzzleImportBarProps {
  onDraft: (draft: ImportedDraft) => void;
  onMatch: (match: ImportedMatch) => void;
}

// Paste-a-store-link bar shown above the add-puzzle form. On a successful extraction it either
// hands the draft to the host page (prefill) or surfaces an existing-puzzle match (dedup).
export const PuzzleImportBar = ({ onDraft, onMatch }: PuzzleImportBarProps) => {
  const t = useTranslations("puzzles");
  const { state, run } = usePuzzleImport();
  const [url, setUrl] = useState("");

  // Auto-prefill the form when there's a clean (no-match) extraction. Runs as an effect so we
  // never call onDraft during render. Keyed on sourceUrl + match presence to avoid re-triggering.
  useEffect(() => {
    if (state.status === "ready" && !state.match) {
      onDraft(state.draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status === "ready" ? state.draft.sourceUrl : null, "match" in state ? state.match?.puzzleId : null]);

  const submit = async () => {
    if (!url.trim()) return;
    await run(url.trim());
  };

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
      <label className="text-sm font-medium">{t("importFromUrl")}</label>
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("importUrlPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? t("importFetching") : t("importFetch")}
        </Button>
      </div>

      {state.status === "error" && (
        <p className="text-sm text-muted-foreground">{t("importFailed")}</p>
      )}

      {state.status === "ready" && state.match && (
        <div className="flex items-center justify-between gap-2 rounded border bg-background p-2">
          <span className="text-sm">{t("importAlreadyExists")}</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => onMatch(state.match!)}>
              {t("importAddToCollection")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onDraft(state.draft);
                toast.message(state.draft.title || t("importFromUrl"));
              }}
            >
              {t("importCreateAnyway")}
            </Button>
          </div>
        </div>
      )}

      {state.status === "ready" && !state.match && (
        <div className="flex items-center gap-3 rounded border bg-background p-2">
          {state.draft.imageUrl && (
            <img
              src={state.draft.imageUrl}
              alt={state.draft.title}
              className="h-12 w-12 rounded object-cover"
            />
          )}
          <div className="text-sm">
            <div className="font-medium">{state.draft.title}</div>
            {state.draft.brand && (
              <div className="text-muted-foreground">{state.draft.brand}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
