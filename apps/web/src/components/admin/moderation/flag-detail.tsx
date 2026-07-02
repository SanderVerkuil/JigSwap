"use client";

// Detail pane for a flagged (auto-rejected) copy photo: the image behind a
// blur-until-reveal guard with a severity badge on top, a metadata grid, and
// the two review decisions. Mutations live in the route; this pane only
// renders and calls back. The destructive action uses the app's two-step
// inline confirm (see photo-lightbox): first click arms, second fires, and an
// armed button disarms itself after 3s.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { EyeOff, ImageOff, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { severityBand, type SeverityBand } from "./severity";

export type FlaggedPhoto = FunctionReturnType<
  typeof gateway.admin.listRejectedPhotos
>[number];

// Semantic tones per severity band: the badge over the image here, and the
// little dot in the queue rows (used by the route's renderRow).
const SEVERITY_BADGE: Record<SeverityBand, string> = {
  high: "border-transparent bg-destructive text-white",
  medium: "border-transparent bg-jigsaw-warning text-white",
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

  // Blur guard: hover lifts it on pointer devices; a tap toggles it on touch.
  // NOTE: the caller keys this pane by imageId, so a different photo never
  // inherits the previous one's reveal or armed confirm.
  const [revealed, setRevealed] = useState(false);
  // Two-step destructive confirm; the timer disarms an unconfirmed click.
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(disarmTimer.current), []);

  const confirmClick = () => {
    clearTimeout(disarmTimer.current);
    if (armed) {
      setArmed(false);
      onConfirmRemoval();
      return;
    }
    setArmed(true);
    disarmTimer.current = setTimeout(() => setArmed(false), 3000);
  };

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
      <div className="group relative aspect-[16/10] overflow-hidden rounded-2xl bg-muted">
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={photo.puzzleTitle}
            className="size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ImageOff className="size-8" aria-hidden />
          </span>
        )}
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/30 text-white backdrop-blur-xl transition-opacity group-hover:opacity-0",
            revealed && "opacity-0",
          )}
        >
          <EyeOff className="size-5" aria-hidden />
          <span className="text-xs font-semibold">{t("reveal")}</span>
        </button>
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

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <Button variant="destructive" onClick={confirmClick} disabled={busy}>
          <Trash2 aria-hidden />
          {armed ? t("confirmArm") : t("confirm")}
        </Button>
        <Button variant="outline" onClick={onRestore} disabled={busy}>
          <Undo2 aria-hidden />
          {t("restore")}
        </Button>
      </div>
    </div>
  );
}
