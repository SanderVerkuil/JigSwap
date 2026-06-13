// apps/web/src/components/add-puzzle/import-zone.tsx
import type { ImportedDraft } from "@/components/puzzle-import/draft-to-form-defaults";
import {
  usePuzzleImport,
  type ImportedMatch,
} from "@/components/puzzle-import/use-puzzle-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CircleCheck, Link, Link2, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

export function ImportZone({
  onDraft,
  onMatch,
}: {
  onDraft: (draft: ImportedDraft) => void;
  onMatch: (match: ImportedMatch) => void;
}) {
  const t = useTranslations("puzzles");
  const { state, run } = usePuzzleImport();
  const [url, setUrl] = useState("");

  // Stable callback refs so the prefill effect never captures stale closures.
  const onDraftRef = useRef(onDraft);
  const onMatchRef = useRef(onMatch);
  useEffect(() => {
    onDraftRef.current = onDraft;
    onMatchRef.current = onMatch;
  });

  const draftKey = state.status === "ready" ? state.draft.sourceUrl : null;
  const matchKey =
    state.status === "ready" ? (state.match?.puzzleId ?? null) : null;
  useEffect(() => {
    if (state.status !== "ready") return;
    if (state.match) onMatchRef.current(state.match);
    else onDraftRef.current(state.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, matchKey]);

  return (
    <section className="rounded-xl border border-primary/25 bg-jigsaw-primary-tint p-5">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="inline-flex size-[30px] items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Link className="size-4" />
        </span>
        <span className="font-heading text-lg font-bold">
          {t("importFromUrl")}
        </span>
      </div>
      <p className="mb-3 ml-10 text-sm text-foreground/80">
        {t("importUrlBlurb")}
      </p>
      <div className="ml-10 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-[15px] -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) void run(url.trim());
            }}
            placeholder="https://www.ravensburger.com/…"
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          onClick={() => url.trim() && run(url.trim())}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> {t("importFetching")}
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> {t("importFetch")}
            </>
          )}
        </Button>
      </div>
      <div className="ml-10 mt-2 min-h-[18px]">
        {state.status === "ready" && !state.match && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-jigsaw-secondary">
            <CircleCheck className="size-3.5" /> {t("importImported")}
          </span>
        )}
        {state.status === "error" && (
          <span className="text-xs text-muted-foreground">
            {t("importFailed")}
          </span>
        )}
      </div>
    </section>
  );
}
