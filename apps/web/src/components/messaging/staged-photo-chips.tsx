"use client";

// The composer's staged photos (spec 3): one horizontally scrollable row of
// thumbnails above the input. A chip shows a progress ring while it converts
// and uploads, a check once it is ready, or its refusal in words; every chip
// can be removed.
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertCircle, Check, ImageIcon, X } from "lucide-react";
import { useTranslations } from "use-intl";
import type { StagedPhoto } from "./photo-staging";

export function StagedPhotoChips({
  photos,
  onRemove,
}: {
  photos: readonly StagedPhoto[];
  onRemove: (key: string) => void;
}) {
  const t = useTranslations("messages.photos");
  if (photos.length === 0) return null;
  return (
    <ul
      aria-label={t("stagedLabel")}
      className="mb-2 flex gap-2 overflow-x-auto pb-1"
    >
      {photos.map((photo, index) => {
        const label = t("photoN", { index: index + 1 });
        const refused = photo.status === "refused";
        return (
          <li
            key={photo.key}
            className={cn(
              // relative: holds the sr-only label inside the scrolling row.
              "bg-background relative flex shrink-0 items-center gap-2 rounded-lg border p-1.5 pr-1",
              refused && "border-destructive/60 max-w-64",
            )}
          >
            <span className="bg-muted relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
              {photo.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.previewUrl}
                  alt=""
                  className={cn(
                    "absolute inset-0 size-full object-cover",
                    photo.status !== "ready" && "opacity-60",
                  )}
                />
              ) : (
                <ImageIcon
                  className="text-muted-foreground size-5"
                  aria-hidden
                />
              )}
              <ChipStatus photo={photo} />
            </span>
            <span className="min-w-0 text-xs" role="status">
              <span className="sr-only">{label}: </span>
              {refused ? (
                <span className="text-destructive line-clamp-3">
                  {t(`refused.${photo.reason}`)}
                </span>
              ) : (
                <span className={cn(photo.status !== "ready" && "sr-only")}>
                  {photo.status === "ready" ? t("ready") : t("uploading")}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 md:size-8"
              onClick={() => onRemove(photo.key)}
              aria-label={t("remove", { label })}
            >
              <X className="size-4" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// Over the thumbnail: a ring (determinate while uploading), a check, or a
// warning. Decorative: the status text says the same.
function ChipStatus({ photo }: { photo: StagedPhoto }) {
  if (photo.status === "ready") {
    return (
      <span
        aria-hidden
        className="bg-primary text-primary-foreground absolute right-0.5 bottom-0.5 rounded-full p-0.5"
      >
        <Check className="size-3" />
      </span>
    );
  }
  if (photo.status === "refused") {
    return (
      <AlertCircle
        aria-hidden
        className="text-destructive absolute size-5 rounded-full bg-white"
      />
    );
  }
  const progress = photo.status === "uploading" ? photo.progress : undefined;
  return <ProgressRing progress={progress} />;
}

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Determinate when `progress` is known, else a spinning quarter arc (static
// under prefers-reduced-motion).
export function ProgressRing({ progress }: { progress?: number }) {
  const determinate = progress !== undefined;
  return (
    <svg
      aria-hidden
      data-testid="progress-ring"
      data-progress={determinate ? Math.round(progress * 100) : undefined}
      viewBox="0 0 24 24"
      className={cn(
        "absolute size-7 -rotate-90 drop-shadow",
        !determinate && "animate-spin motion-reduce:animate-none",
      )}
    >
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        fill="none"
        strokeWidth="3"
        className="stroke-white/50"
      />
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-white transition-[stroke-dashoffset] motion-reduce:transition-none"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - (determinate ? progress : 0.25))}
      />
    </svg>
  );
}
