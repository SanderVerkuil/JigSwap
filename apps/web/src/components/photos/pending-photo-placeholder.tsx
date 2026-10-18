"use client";

// A photo that exists but may not be shown yet (still being screened): the server sends only a
// low-detail blurhash (4x3 components — colour blobs, no shapes), which is decoded to a tiny image
// and stretched behind a "Pending review" chip. Without a blurhash it renders a neutral tile.
import { cn } from "@/lib/utils";
import { decode, isBlurhashValid } from "blurhash";
import { Clock } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "use-intl";

// Decoded size: the browser's image smoothing turns 32x24 into a soft gradient at any tile size.
const DECODE_WIDTH = 32;
const DECODE_HEIGHT = 24;

/** Decode a blurhash to a PNG data URL, or null when invalid or no canvas is available (SSR). */
export const blurhashToDataUrl = (blurhash: string | null): string | null => {
  if (!blurhash || typeof document === "undefined") return null;
  if (!isBlurhashValid(blurhash).result) return null;
  const canvas = document.createElement("canvas");
  canvas.width = DECODE_WIDTH;
  canvas.height = DECODE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const pixels = decode(blurhash, DECODE_WIDTH, DECODE_HEIGHT);
  const imageData = context.createImageData(DECODE_WIDTH, DECODE_HEIGHT);
  imageData.data.set(pixels);
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};

export function PendingPhotoPlaceholder({
  blurhash,
  compact = false,
  className,
}: {
  blurhash: string | null;
  /** Icon-only chip, for small thumbnails. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  const src = useMemo(() => blurhashToDataUrl(blurhash), [blurhash]);
  return (
    <div
      role="img"
      aria-label={t("photoPendingReview")}
      className={cn("bg-muted relative overflow-hidden", className)}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span
        className={cn(
          "absolute inline-flex items-center gap-1 rounded-full bg-black/55 font-bold text-white",
          compact
            ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-1"
            : "left-2 top-2 px-2 py-0.5 text-[10px]",
        )}
      >
        <Clock className={compact ? "h-3 w-3" : "h-2.5 w-2.5"} aria-hidden />
        {!compact && t("photoPendingReview")}
      </span>
    </div>
  );
}
