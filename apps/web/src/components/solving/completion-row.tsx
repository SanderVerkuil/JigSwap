import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { CoverChip } from "@/components/library/cover-chip";
import { chipColor } from "@/components/library/palette";
import { EditSolveButton } from "@/components/solving/edit-solve-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { gateway } from "@/gateway";
import {
  formatCompletionDate,
  formatCompletionMeta,
  hrefForLink,
} from "@/lib/completion-format";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { CircleCheck, Clock, Star, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

// One of the member's solves as listMyCompletions returns it.
export type CompletionRowData = FunctionReturnType<
  typeof gateway.solving.myCompletions
>[number];

// What a row asks the completion log to open; the log owns the dialogs.
export type CompletionDialogRequest =
  | {
      kind: "finish";
      completionId: string;
      startDate: number;
      puzzleTitle?: string;
    }
  | {
      kind: "edit";
      completionId: string;
      inProgress: boolean;
      startDate: number;
      endDate?: number;
      timeMinutes?: number;
      notes?: string;
      datePrecision?: "day" | "year" | "unknown";
    }
  | {
      kind: "review";
      puzzleId: string;
      copyId?: string;
    }
  | { kind: "delete"; completionId: string };

// A row of the completion log: cover, title, meta line, notes, copy line, photos, date and the
// row's actions.
export function CompletionRow({
  completion,
  info,
  index,
  isLast,
  onOpenDialog,
}: {
  completion: CompletionRowData;
  /** Title and piece count from the member's library, when the copy is theirs. */
  info?: { title: string; pieceCount?: number };
  index: number;
  isLast: boolean;
  onOpenDialog: (request: CompletionDialogRequest) => void;
}) {
  const t = useTranslations("solving.completions");
  // Borrowed copies aren't in the viewer's library, so fall back to the durable
  // copySnapshot for the title and piece count.
  const snapshot =
    "copySnapshot" in completion ? completion.copySnapshot : undefined;
  const puzzleTitle = info?.title ?? snapshot?.title;
  const title = puzzleTitle ?? t("title");
  const pieceCount = info?.pieceCount ?? snapshot?.pieceCount;
  const done = completion.isCompleted;
  // "1,000 pieces · 3h 20m" (a typed time), "· over 3 days" or "· in one day"; "Started {date}"
  // while in progress. Year-only and undated solves never get a duration.
  const metaLine = formatCompletionMeta(t, completion, pieceCount);

  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center gap-3.5 py-3.5",
        !isLast && "border-b",
      )}
    >
      {completion.thumbnailUrl && completion.link ? (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={hrefForLink(completion.link)}
                aria-label={title}
                className="relative z-10 shrink-0"
              >
                <Image
                  src={completion.thumbnailUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-lg border bg-muted object-contain"
                />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top" className="p-1.5">
              <img
                src={completion.thumbnailUrl}
                alt=""
                className="max-h-[280px] max-w-[260px] rounded-md object-contain"
              />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : completion.thumbnailUrl ? (
        <Image
          src={completion.thumbnailUrl}
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-lg border bg-muted object-contain"
        />
      ) : (
        <CoverChip
          color={chipColor(index)}
          icon={done ? CircleCheck : Clock}
          size={44}
        />
      )}
      <div className="min-w-0 flex-1 basis-52">
        <div className="flex flex-wrap items-center gap-2">
          {completion.link ? (
            <Link
              href={hrefForLink(completion.link)}
              className="text-sm font-semibold after:absolute after:inset-0 after:z-[1] after:content-[''] hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {title}
            </Link>
          ) : (
            <span className="text-sm font-semibold">{title}</span>
          )}
          {!done && (
            <Badge variant="secondary" className="text-xs">
              {t("inProgress")}
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">{metaLine}</div>
        {completion.notes && (
          <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
            {completion.notes}
          </p>
        )}
        {"copySnapshot" in completion && completion.copySnapshot != null && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {completion.copySnapshot.wasBorrowed
              ? t(done ? "solvedBorrowedCopy" : "solvingBorrowedCopy")
              : t(done ? "solvedOwnCopy" : "solvingOwnCopy")}
            {"allPiecesPresent" in completion &&
            completion.allPiecesPresent === false
              ? ` — ${t("piecesMissing")}`
              : "allPiecesPresent" in completion &&
                  completion.allPiecesPresent === true
                ? ` — ${t("piecesComplete")}`
                : ""}
          </p>
        )}
        {completion.photoItems && completion.photoItems.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {completion.photoItems.map((photo, photoIndex) => (
                <Tooltip key={`${photo.url}-${photoIndex}`}>
                  <TooltipTrigger asChild>
                    {/* Not a link (no nav target) — a focusable no-op button so keyboard
                        users can surface the tooltip; z-10 lifts it above the stretched
                        row link. */}
                    <button
                      type="button"
                      aria-label={
                        photo.pending
                          ? `${title} — ${t("pendingReview")}`
                          : title
                      }
                      className="relative z-10 shrink-0 rounded-md"
                    >
                      <Image
                        src={photo.url}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 rounded-md border bg-muted object-contain"
                      />
                      {photo.pending && (
                        <Badge
                          variant="secondary"
                          className="pointer-events-none absolute inset-x-0 bottom-0 justify-center rounded-none rounded-b-md px-0.5 py-0 text-[10px]"
                        >
                          {t("pendingReview")}
                        </Badge>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="p-1.5">
                    <img
                      src={photo.url}
                      alt=""
                      className="max-h-[280px] max-w-[260px] rounded-md object-contain"
                    />
                    {photo.pending && (
                      <p className="mt-1 text-center text-xs">
                        {t("pendingReview")}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        )}
      </div>

      <span className="text-muted-foreground w-[78px] text-right text-xs whitespace-nowrap">
        {formatCompletionDate(t, completion)}
      </span>

      <div className="relative z-10 flex items-center gap-1">
        {!done && completion.aggregateId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onOpenDialog({
                kind: "finish",
                completionId: completion.aggregateId!,
                startDate: completion.startDate,
                puzzleTitle,
              })
            }
          >
            <CircleCheck className="h-4 w-4" />
            {t("finish")}
          </Button>
        )}
        {completion.puzzleId != null && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={t("review")}
            aria-label={t("review")}
            onClick={() =>
              onOpenDialog({
                kind: "review",
                puzzleId: completion.puzzleId!,
                copyId: completion.ownedPuzzleId ?? undefined,
              })
            }
          >
            <Star className="h-4 w-4" />
          </Button>
        )}
        {completion.aggregateId && (
          // Unavailable (with the reason) once the server's edit window has closed.
          <EditSolveButton
            editableUntil={completion.editableUntil}
            onEdit={() =>
              onOpenDialog({
                kind: "edit",
                completionId: completion.aggregateId!,
                inProgress: !done,
                startDate: completion.startDate,
                endDate: completion.endDate,
                timeMinutes: completion.completionTimeMinutes,
                notes: completion.notes,
                datePrecision: completion.datePrecision,
              })
            }
          />
        )}
        {completion.aggregateId && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            title={t("delete")}
            aria-label={t("delete")}
            onClick={() =>
              onOpenDialog({
                kind: "delete",
                completionId: completion.aggregateId!,
              })
            }
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
