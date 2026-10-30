"use client";

// Detail pane for a review request: a message photo the automated check stopped, whose sender
// asked for a review ("Ask for a review" in the thread). The admin sees the photo alone, never the
// conversation or its recipient: the image behind the click-to-reveal blur guard (RevealGuard)
// with its severity badge, a metadata grid (verdict, sender, when it was sent and when the review
// was asked), and the two decisions, each with one sentence beside the buttons saying what it
// does. Restore approves the photo (delivered once its sender has sent it) and fires directly;
// Keep removed deletes it for good, so it asks first in an AlertDialog that says so
// (ConfirmAction). Without a preview (no passed hash check yet, or the file is gone) the server
// refuses a restore, so Restore is off and the pane says why. Mutations live in the route; the
// caller keys this pane per request so a reveal never carries over.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import { ImageOff, Trash2, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { ConfirmAction } from "./confirm-action";
import { SEVERITY_BADGE } from "./flag-detail";
import { RevealGuard } from "./reveal-guard";
import { severityBand } from "./severity";

export type ImageReviewRequest = FunctionReturnType<
  typeof gateway.admin.listImageReviewRequests
>[number];

export function AppealDetail({
  request,
  busy,
  onRestore,
  onKeepRemoved,
}: {
  request: ImageReviewRequest;
  busy: boolean;
  onRestore: () => void;
  onKeepRemoved: () => void;
}) {
  const t = useTranslations("admin.moderation.appeal");
  const tFlag = useTranslations("admin.moderation.flag");
  const format = useFormatter();
  const band = severityBand(request.score);
  const when = (at: number) =>
    format.dateTime(at, { dateStyle: "medium", timeStyle: "short" });

  const meta: [string, string][] = [
    [t("label"), request.label ?? tFlag("unlabeled")],
    [
      t("score"),
      request.score == null
        ? "—"
        : format.number(request.score, {
            style: "percent",
            maximumFractionDigits: 0,
          }),
    ],
    [t("sentBy"), request.uploaderName ?? "—"],
    [t("uploadedAt"), when(request.uploadedAt)],
    [t("requestedAt"), when(request.reviewRequestedAt)],
    ...(request.reason == null
      ? []
      : ([[t("reason"), request.reason]] as [string, string][])),
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-muted">
        {request.url ? (
          <RevealGuard>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={request.url}
              alt={t("imageAlt")}
              className="size-full object-cover"
            />
          </RevealGuard>
        ) : (
          // Body text on the muted frame: muted-foreground would fall below AA contrast on it.
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-foreground/80">
            <ImageOff className="size-8 text-muted-foreground" aria-hidden />
            {t("noPreview")}
          </span>
        )}
        <Badge className={cn("absolute top-3 left-3", SEVERITY_BADGE[band])}>
          {tFlag(`severity.${band}`)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {meta.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-xs tracking-wider text-muted-foreground uppercase">
              {label}
            </div>
            <div className="mt-0.5 text-sm font-semibold [overflow-wrap:anywhere]">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* What each decision does, one sentence each, beside the buttons. */}
      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <li className="flex gap-2">
          <Undo2 className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("effects.restore")}
        </li>
        <li className="flex gap-2">
          <Trash2 className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("effects.keepRemoved")}
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button onClick={onRestore} disabled={busy || request.url === null}>
          <Undo2 aria-hidden />
          {t("restore")}
        </Button>
        <ConfirmAction
          trigger={
            <Button variant="destructive" disabled={busy}>
              <Trash2 aria-hidden />
              {t("keepRemoved")}
            </Button>
          }
          title={t("keepConfirmTitle")}
          description={t("keepConfirmBody")}
          confirmLabel={t("keepConfirmAction")}
          destructive
          onConfirm={onKeepRemoved}
        />
      </div>
    </div>
  );
}
