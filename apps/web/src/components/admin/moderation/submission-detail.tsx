"use client";

// Detail pane for a pending catalog submission: cover, metadata, a
// possible-duplicate warning (cheap title match against the approved-only
// suggestions search index, run for the selected item only), and the three
// moderation actions. Mutations live in the route; this pane only renders
// and calls back.

import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, Check, Pencil, Puzzle, X } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

export type PendingSubmission = FunctionReturnType<
  typeof gateway.catalog.pending
>[number];

// The catalog's unified no-image fallback (same gradient + glyph treatment as
// puzzle-card-shell), sized by the caller.
export function SubmissionCover({
  url,
  title,
  className,
}: {
  url: string | null | undefined;
  title: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-lg",
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title} className="size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-jigsaw-primary/15 to-jigsaw-primary-accent/15 text-jigsaw-primary/50">
          <Puzzle className="size-1/2" aria-hidden />
        </span>
      )}
    </span>
  );
}

// Loose-but-cheap title equivalence for the dup check: normalized equality or
// containment either way, so "Starry Night" flags "Starry Night (1000pc)".
function findTitleMatch(
  title: string,
  candidates: { title: string }[] | undefined,
) {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const target = norm(title);
  if (!target) return undefined;
  return candidates?.find((candidate) => {
    const other = norm(candidate.title);
    return other === target || other.includes(target) || target.includes(other);
  });
}

export function SubmissionDetail({
  submission,
  busy,
  onApprove,
  onEditApprove,
  onReject,
}: {
  submission: PendingSubmission;
  busy: boolean;
  onApprove: () => void;
  onEditApprove: () => void;
  onReject: () => void;
}) {
  const t = useTranslations("admin.moderation");
  const tDifficulty = useTranslations("puzzles.puzzles.difficulty");
  const format = useFormatter();

  // Possible-dup check for the SELECTED submission only: the approved-only
  // suggestions index is the catalog's existing cheap title lookup.
  const { data: suggestions } = useQuery(
    convexQuery(gateway.catalog.puzzleSuggestions, {
      searchTerm: submission.title,
      limit: 5,
    }),
  );
  const dup = findTitleMatch(submission.title, suggestions);

  const meta: [string, string][] = [
    [t("detail.submitted"), format.relativeTime(submission.createdAt)],
  ];
  if (submission.difficulty) {
    meta.push([t("detail.difficulty"), tDifficulty(submission.difficulty)]);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-4">
        <SubmissionCover
          url={submission.image}
          title={submission.title}
          className="size-[92px] rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold">{submission.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {submission.brand && `${submission.brand} · `}
            {t("pieces", { count: submission.pieceCount })}
            {submission.difficulty &&
              ` · ${tDifficulty(submission.difficulty)}`}
          </p>
          {submission.tags && submission.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {submission.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {dup && (
        <div className="flex items-start gap-2.5 rounded-lg border border-jigsaw-warning/30 bg-jigsaw-warning/10 px-3.5 py-3">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-jigsaw-warning"
            aria-hidden
          />
          <p className="text-sm">
            {t.rich("dupWarning", {
              title: dup.title,
              strong: (chunks) => (
                <strong className="font-semibold">{chunks}</strong>
              ),
            })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {meta.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs tracking-wider text-muted-foreground uppercase">
              {label}
            </div>
            <div className="mt-0.5 text-sm font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {submission.description && (
        <div>
          <div className="text-xs tracking-wider text-muted-foreground uppercase">
            {t("detail.note")}
          </div>
          <p className="mt-1 text-sm leading-relaxed italic">
            “{submission.description}”
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <Button onClick={onApprove} disabled={busy}>
          <Check aria-hidden />
          {t("actions.approve")}
        </Button>
        <Button variant="outline" onClick={onEditApprove} disabled={busy}>
          <Pencil aria-hidden />
          {t("actions.edit")}
        </Button>
        <Button
          variant="ghost"
          onClick={onReject}
          disabled={busy}
          className="ml-auto text-destructive hover:text-destructive"
        >
          <X aria-hidden />
          {t("reject")}
        </Button>
      </div>
    </div>
  );
}
