"use client";

// Detail pane for a photo nobody has decided (pending / unscored, or its hash check timed out): the image behind
// the same blur-until-reveal guard as the flagged pane, a metadata grid (status, why it could not
// be checked, puzzle, uploader) and the two manual decisions, plus "Check again" for an unscored
// photo (`canRecheck`). A photo whose hash check timed out gets "Approve without hash check" in
// place of Approve (the server refuses a plain approval for it). Mutations live in the route; reject
// and the waiver use the app's two-step inline confirm (first click arms, second fires, disarms
// after 3s).
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import type { FunctionReturnType } from "convex/server";
import {
  Check,
  EyeOff,
  ImageOff,
  RotateCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

export type UncheckedPhoto = FunctionReturnType<
  typeof gateway.admin.listUncheckedPhotos
>[number];

const KNOWN_REASONS = new Set([
  "missing_token",
  "auth",
  "rate_limited",
  "model_unavailable",
  "provider_error",
  "network",
  "bad_response",
  "missing_file",
  "download_error",
  "internal_error",
  "check_failed",
  "stalled",
]);

export function UncheckedDetail({
  photo,
  busy,
  onApprove,
  onWaive,
  onReject,
  onRecheck,
}: {
  photo: UncheckedPhoto;
  busy: boolean;
  onApprove: () => void;
  onWaive: () => void;
  onReject: () => void;
  onRecheck: () => void;
}) {
  const t = useTranslations("admin.moderation.unchecked");
  // NOTE: the caller keys this pane by photo, so reveal/armed state never carries over.
  const [revealed, setRevealed] = useState(false);
  // Which two-step action is armed (at most one at a time).
  const [armed, setArmed] = useState<"reject" | "waive" | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(disarmTimer.current), []);

  const twoStep = (action: "reject" | "waive", fire: () => void) => () => {
    clearTimeout(disarmTimer.current);
    if (armed === action) {
      setArmed(null);
      fire();
      return;
    }
    setArmed(action);
    disarmTimer.current = setTimeout(() => setArmed(null), 3000);
  };
  const timedOut = photo.status === "hashTimedOut";

  const reason =
    photo.reason == null
      ? "—"
      : KNOWN_REASONS.has(photo.reason)
        ? t(`reason.${photo.reason}` as "reason.unknown")
        : t("reason.unknown");
  const meta: [string, string][] = [
    [t("statusLabel"), t(`status.${photo.status}`)],
    [t("reasonLabel"), reason],
    [t("onPuzzle"), photo.puzzleTitle],
    [t("uploadedBy"), photo.uploaderName ?? "—"],
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
        <Badge className="absolute top-3 left-3 border-transparent bg-jigsaw-warning text-white">
          {t(`source.${photo.source}`)}
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

      <p className="text-xs text-muted-foreground">
        {timedOut ? t("hashTimedOutHint") : t("hint")}
      </p>

      <div className="flex flex-wrap items-center gap-2.5">
        {timedOut ? (
          <Button onClick={twoStep("waive", onWaive)} disabled={busy}>
            <ShieldAlert aria-hidden />
            {armed === "waive" ? t("waiveArm") : t("waive")}
          </Button>
        ) : (
          <Button onClick={onApprove} disabled={busy}>
            <Check aria-hidden />
            {t("approve")}
          </Button>
        )}
        <Button
          variant="destructive"
          onClick={twoStep("reject", onReject)}
          disabled={busy}
        >
          <X aria-hidden />
          {armed === "reject" ? t("rejectArm") : t("reject")}
        </Button>
        {photo.canRecheck && (
          <Button variant="outline" onClick={onRecheck} disabled={busy}>
            <RotateCw aria-hidden />
            {t("recheck")}
          </Button>
        )}
      </div>
    </div>
  );
}
