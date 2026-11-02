import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { CoverChip } from "@/components/library/cover-chip";
import { chipColor } from "@/components/library/palette";
import {
  MessagePhotoLightbox,
  type LightboxPhoto,
} from "@/components/messaging/message-photo-lightbox";
import {
  EditSolveButton,
  EditSolveMenuItem,
} from "@/components/solving/edit-solve-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { gateway } from "@/gateway";
import {
  formatCompletionDate,
  formatCompletionMeta,
  hrefForLink,
  solveDuration,
} from "@/lib/completion-format";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { CircleCheck, Clock, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
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
  // `opener` is what focus returns to when the dialog closes: the button that was used, or the
  // menu button for an item of the phone menu (the item itself is gone by then).
  onOpenDialog: (
    request: CompletionDialogRequest,
    opener: HTMLElement | null,
  ) => void;
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

  // The solve's photos open full size in the photo viewer (zoom, swipe, arrow keys), and focus
  // returns to the thumbnail that opened it.
  const photoItems = completion.photoItems ?? [];
  const [viewing, setViewing] = useState<number | null>(null);
  const viewerOpenerRef = useRef<HTMLButtonElement | null>(null);
  const viewerPhotos: LightboxPhoto[] = photoItems.map((photo, photoIndex) => ({
    // Only a key for the viewer: own photos are never reported.
    attachmentId: `${photoIndex}:${photo.url}`,
    url: photo.url,
    alt: t("photoAlt", { title, pending: String(photo.pending) }),
  }));

  // The row's actions; each is absent when the row can't offer it (legacy rows have no
  // aggregateId, rows without a puzzle can't be reviewed).
  const completionId = completion.aggregateId;
  const puzzleId = completion.puzzleId;
  const canFinish = !done && Boolean(completionId);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const openFinish = (opener: HTMLElement) => {
    if (!completionId) return;
    onOpenDialog(
      {
        kind: "finish",
        completionId,
        startDate: completion.startDate,
        puzzleTitle,
      },
      opener,
    );
  };
  const openReview =
    puzzleId != null
      ? (opener: HTMLElement | null) =>
          onOpenDialog(
            {
              kind: "review",
              puzzleId,
              copyId: completion.ownedPuzzleId ?? undefined,
            },
            opener,
          )
      : undefined;
  const openEdit = completionId
    ? (opener: HTMLElement | null) =>
        onOpenDialog(
          {
            kind: "edit",
            completionId,
            inProgress: !done,
            startDate: completion.startDate,
            endDate: completion.endDate,
            // Only a time the member typed: a duration the server derived from the dates starts
            // empty, so moving a date re-derives it instead of saving the old one as if typed.
            timeMinutes:
              solveDuration(completion)?.kind === "time"
                ? completion.completionTimeMinutes
                : undefined,
            notes: completion.notes,
            datePrecision: completion.datePrecision,
          },
          opener,
        )
    : undefined;
  const openDelete = completionId
    ? (opener: HTMLElement | null) =>
        onOpenDialog({ kind: "delete", completionId }, opener)
    : undefined;

  return (
    <div
      className={cn(
        "relative flex flex-wrap items-center gap-3.5 py-3.5",
        !isLast && "border-b",
      )}
    >
      {viewing !== null && (
        <MessagePhotoLightbox
          photos={viewerPhotos}
          index={viewing}
          onIndexChange={setViewing}
          open
          onOpenChange={(open) => {
            if (!open) setViewing(null);
          }}
          // The member's own photos: there is nothing to report, so no author name is shown.
          authorName=""
          own
          returnFocusRef={viewerOpenerRef}
        />
      )}
      {completion.thumbnailUrl && completion.link ? (
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
      <div className="min-w-0 flex-1 basis-40">
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
        {photoItems.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {photoItems.map((photo, photoIndex) => (
              // z-10 lifts it above the stretched row link. A tap opens the photo viewer.
              <button
                key={`${photo.url}-${photoIndex}`}
                type="button"
                aria-label={t("photoLabel", {
                  title,
                  index: photoIndex + 1,
                  count: photoItems.length,
                  pending: String(photo.pending),
                })}
                className="focus-visible:ring-ring relative z-10 shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none"
                onClick={(event) => {
                  viewerOpenerRef.current = event.currentTarget;
                  setViewing(photoIndex);
                }}
              >
                <Image
                  src={photo.url}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 rounded-md border bg-muted object-contain"
                />
                {photo.pending && (
                  // Pending review (said in the button's name): a corner mark that fits the
                  // thumbnail in every language.
                  <span
                    aria-hidden
                    className="bg-background text-muted-foreground pointer-events-none absolute -right-1 -bottom-1 inline-flex size-4 items-center justify-center rounded-full border"
                  >
                    <Clock className="size-2.5" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* From sm up the wrapper dissolves and the date sits in the row like before. */}
      <div className="flex flex-col items-end gap-1 sm:contents">
        <span className="text-muted-foreground w-[78px] text-right text-xs whitespace-nowrap">
          {formatCompletionDate(t, completion)}
        </span>
        {/* Below sm: the row's actions in one 44px menu under the date, so they never take a
            line of their own (Finish stays a visible button). */}
        {(openReview || openEdit || openDelete) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTriggerRef}
                variant="ghost"
                size="icon"
                className="relative z-10 -mr-3 size-11 sm:hidden"
                aria-label={t("actionsLabel", { title })}
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {openReview && (
                <DropdownMenuItem
                  className="pointer-coarse:min-h-11"
                  onSelect={() => openReview(menuTriggerRef.current)}
                >
                  <Star aria-hidden />
                  {t("review")}
                </DropdownMenuItem>
              )}
              {openEdit && (
                <EditSolveMenuItem
                  editableUntil={completion.editableUntil}
                  onEdit={() => openEdit(menuTriggerRef.current)}
                />
              )}
              {openDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="pointer-coarse:min-h-11"
                    onSelect={() => openDelete(menuTriggerRef.current)}
                  >
                    <Trash2 aria-hidden />
                    {t("delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div
        className={cn(
          "relative z-10 items-center gap-2",
          canFinish ? "flex" : "hidden sm:flex",
        )}
      >
        {canFinish && (
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:min-h-11"
            onClick={(event) => openFinish(event.currentTarget)}
          >
            <CircleCheck className="h-4 w-4" />
            {t("finish")}
          </Button>
        )}
        {/* From sm up: the actions as icon buttons, 44px on touch. */}
        <div className="hidden items-center gap-2 sm:flex">
          {openReview && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 pointer-coarse:size-11"
              title={t("review")}
              aria-label={t("review")}
              onClick={(event) => openReview(event.currentTarget)}
            >
              <Star className="h-4 w-4" />
            </Button>
          )}
          {openEdit && (
            // Unavailable (with the reason) once the server's edit window has closed.
            <EditSolveButton
              editableUntil={completion.editableUntil}
              onEdit={openEdit}
            />
          )}
          {openDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive pointer-coarse:size-11"
              title={t("delete")}
              aria-label={t("delete")}
              onClick={(event) => openDelete(event.currentTarget)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
