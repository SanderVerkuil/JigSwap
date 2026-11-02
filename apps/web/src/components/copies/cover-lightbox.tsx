"use client";

import { PhotoZoom } from "@/components/copies/photo-zoom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// A copy's cover, large: the photo lightbox's dark stage and zoom (pinch, drag, double-tap, buttons)
// with nothing else beside it. For a phone, where the page shows the cover as a thumbnail.
export function CoverLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        // The close button matches the zoom buttons: legible on the stage, light theme or dark.
        className="h-[90dvh] max-w-[96vw] overflow-hidden bg-neutral-950 p-0 sm:max-w-[96vw] [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:bg-black/45 [&>[data-slot=dialog-close]]:text-white [&>[data-slot=dialog-close]]:hover:bg-black/70 [&>[data-slot=dialog-close]]:hover:text-white"
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <PhotoZoom src={src} alt={alt} />
      </DialogContent>
    </Dialog>
  );
}
