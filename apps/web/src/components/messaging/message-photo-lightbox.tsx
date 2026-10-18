"use client";

// Full-size viewer for a thread's photos (spec 3): the copy gallery's
// PhotoZoom surface (pinch / pan / double-tap zoom, swipe between photos),
// arrow keys, Esc to close, and Radix's focus trap with focus returned to the
// tile that opened it. Others' photos carry "Report photo" (targetKind
// attachment) inside the viewer.
import { PhotoZoom } from "@/components/copies/photo-zoom";
import { ReportDialog } from "@/components/safety/report-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Id } from "@/gateway";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "use-intl";

export type LightboxPhoto = {
  attachmentId: string;
  url: string;
  /** "Photo from {name}", plus the caption. */
  alt: string;
};

export function MessagePhotoLightbox({
  photos,
  index,
  onIndexChange,
  open,
  onOpenChange,
  authorName,
  authorId,
  own,
  returnFocusRef,
}: {
  photos: readonly LightboxPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authorName: string;
  authorId?: Id<"users">;
  /** The viewer's own photos: nothing to report. */
  own: boolean;
  /** Focus goes back here on close (the viewer has no Radix trigger). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("copyInstance.photoLightbox");
  const tSafety = useTranslations("safety");
  const [reporting, setReporting] = useState(false);
  const reportRef = useRef<HTMLButtonElement>(null);
  const count = photos.length;
  const photo = photos[Math.min(index, count - 1)];

  const go = (delta: number) => {
    if (count > 1) onIndexChange((index + delta + count) % count);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goRef.current(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goRef.current(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count]);

  if (!photo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
        className="grid h-[90dvh] max-h-[90dvh] w-full max-w-[96vw] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden bg-neutral-950 p-0 text-white sm:max-w-[96vw] md:max-w-[min(94vw,1200px)]"
      >
        <DialogTitle className="sr-only">{photo.alt}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("counter", { current: index + 1, total: count })}
        </DialogDescription>
        <div className="relative flex min-h-0 items-center justify-center">
          <PhotoZoom
            key={photo.attachmentId}
            src={photo.url}
            alt={photo.alt}
            onSwipe={count > 1 ? go : undefined}
          />
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t("prev")}
                className="absolute top-1/2 left-3 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 focus:ring-2 focus:ring-white/70 focus:outline-none motion-reduce:transition-none"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t("next")}
                className="absolute top-1/2 right-3 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 focus:ring-2 focus:ring-white/70 focus:outline-none motion-reduce:transition-none"
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 font-mono text-xs font-semibold">
                {t("counter", { current: index + 1, total: count })}
              </span>
            </>
          )}
        </div>
        {!own && (
          <div className="flex justify-end border-t border-white/10 p-2">
            <Button
              ref={reportRef}
              variant="ghost"
              onClick={() => setReporting(true)}
              className="h-11 text-red-300 hover:bg-white/10 hover:text-red-200 md:h-9"
            >
              <Flag className="size-4" aria-hidden />
              {tSafety("reportPhoto")}
            </Button>
          </div>
        )}
        {/* Inside the content: a nested layer, so it doesn't close the viewer. */}
        <ReportDialog
          target={{ kind: "attachment", id: photo.attachmentId }}
          name={authorName}
          memberId={authorId}
          open={reporting}
          onOpenChange={setReporting}
          returnFocusRef={reportRef}
        />
      </DialogContent>
    </Dialog>
  );
}
