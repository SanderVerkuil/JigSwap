"use client";

// Detail pane for a flagged (auto-rejected) copy photo: the image behind a
// click-to-reveal blur guard (RevealGuard) with a severity badge on top, a metadata grid, and
// the two review decisions. Mutations live in the route; this pane only
// renders and calls back. Confirm removal deletes the photo and notifies the
// uploader, so it asks first in an AlertDialog that says exactly that
// (ConfirmAction); Restore is not destructive and fires directly. A photo
// rejected after its hash check timed out (`hashTimedOut`) says that
// restoring it does not publish it.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { ImageOff, Trash2, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { ConfirmAction } from "./confirm-action";
import { RevealGuard } from "./reveal-guard";
import { severityBand, type SeverityBand } from "./severity";

export type FlaggedPhoto = FunctionReturnType<
  typeof gateway.admin.listRejectedPhotos
>[number];

// Semantic tones per severity band: the badge over the image here, and the
// little dot in the queue rows (used by the route's renderRow). The badge
// colours are fixed rather than theme tokens so the small text keeps AA
// contrast in both themes: white on the dark-mode destructive red and on
// amber fails it.
const SEVERITY_BADGE: Record<SeverityBand, string> = {
  high: "border-transparent bg-red-700 text-white",
  medium: "border-transparent bg-jigsaw-warning text-amber-950",
  low: "border-transparent bg-muted text-muted-foreground",
};

export const SEVERITY_DOT: Record<SeverityBand, string> = {
  high: "bg-destructive",
  medium: "bg-jigsaw-warning",
  low: "bg-muted-foreground",
};

export function FlagDetail({
  photo,
  busy,
  onConfirmRemoval,
  onRestore,
}: {
  photo: FlaggedPhoto;
  busy: boolean;
  onConfirmRemoval: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("admin.moderation.flag");
  const format = useFormatter();
  const band = severityBand(photo.score);

  // NOTE: the caller keys this pane by imageId, so a different photo never
  // inherits the previous one's reveal.

  const meta: [string, string][] = [
    [t("onPuzzle"), photo.puzzleTitle],
    [t("uploadedBy"), photo.uploaderName ?? "—"],
    [t("label"), photo.label ?? t("unlabeled")],
    [
      t("score"),
      photo.score == null
        ? "—"
        : format.number(photo.score, {
            style: "percent",
            maximumFractionDigits: 0,
          }),
    ],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-muted">
        {photo.url ? (
          <RevealGuard>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.puzzleTitle}
              className="size-full object-cover"
            />
          </RevealGuard>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" aria-hidden />
          </span>
        )}
        <Badge className={cn("absolute top-3 left-3", SEVERITY_BADGE[band])}>
          {t(`severity.${band}`)}
        </Badge>
      </div>

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

      {photo.hashTimedOut && (
        <p className="text-xs text-muted-foreground">{t("hashTimedOutHint")}</p>
      )}

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <ConfirmAction
          trigger={
            <Button variant="destructive" disabled={busy}>
              <Trash2 aria-hidden />
              {t("confirm")}
            </Button>
          }
          title={t("confirmTitle")}
          description={t("confirmBody")}
          confirmLabel={t("confirmAction")}
          destructive
          onConfirm={onConfirmRemoval}
        />
        <Button variant="outline" onClick={onRestore} disabled={busy}>
          <Undo2 aria-hidden />
          {t("restore")}
        </Button>
      </div>
    </div>
  );
}
