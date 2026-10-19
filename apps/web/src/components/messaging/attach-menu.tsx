"use client";

// The composer's paperclip, between the text field and Send: a Radix menu
// opening upward (aligned to its right edge) on desktop, a short bottom sheet
// of tiles on phones. The paperclip stays highlighted while open. Photo
// is left out when photos are unavailable, Location when location sharing is
// (no map key configured, or a thread probe still loading). The file input itself lives in the
// composer, outside this menu, so iOS keeps the user gesture.
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ImageIcon,
  MapPin,
  Paperclip,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import { useState, type Ref } from "react";
import { useTranslations } from "use-intl";

type AttachOption = {
  key: "puzzle" | "photo" | "location";
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
};

export function AttachMenu({
  triggerRef,
  photosAvailable,
  locationAvailable = false,
  onPuzzle,
  onPhoto,
  onLocation,
}: {
  triggerRef?: Ref<HTMLButtonElement>;
  photosAvailable: boolean;
  locationAvailable?: boolean;
  /** Absent: "Attach a puzzle" isn't offered here. */
  onPuzzle?: () => void;
  /** Must open the file picker synchronously (the user gesture). */
  onPhoto: () => void;
  onLocation?: () => void;
}) {
  const t = useTranslations("messages");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const options: AttachOption[] = [
    ...(onPuzzle
      ? [
          {
            key: "puzzle" as const,
            label: t("attachPuzzle"),
            icon: Puzzle,
            onSelect: onPuzzle,
          },
        ]
      : []),
    ...(photosAvailable
      ? [
          {
            key: "photo" as const,
            label: t("photos.attachPhoto"),
            icon: ImageIcon,
            onSelect: onPhoto,
          },
        ]
      : []),
    ...(locationAvailable && onLocation
      ? [
          {
            key: "location" as const,
            label: t("locations.attachLocation"),
            icon: MapPin,
            onSelect: onLocation,
          },
        ]
      : []),
  ];

  // Nothing to attach in this thread: no paperclip at all.
  if (options.length === 0) return null;

  const trigger = (
    <Button
      ref={triggerRef}
      variant="ghost"
      size="icon"
      className={cn(
        "text-muted-foreground size-11 shrink-0 rounded-full md:size-10",
        open && "bg-accent text-accent-foreground",
      )}
      aria-label={t("attach")}
      aria-haspopup={isMobile ? "dialog" : "menu"}
      aria-expanded={open}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <Paperclip aria-hidden className="size-5" />
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="gap-3 rounded-t-xl p-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetTitle className="text-base font-semibold">
              {t("attach")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("attachDescription")}
            </SheetDescription>
            <div className="grid grid-cols-4 gap-2">
              {options.map(({ key, label, icon: Icon, onSelect }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    // Picker first, while the tap still counts as a gesture.
                    onSelect();
                    setOpen(false);
                  }}
                  className="hover:bg-accent focus-visible:ring-ring flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-medium outline-none focus-visible:ring-2"
                >
                  <Icon className="text-primary-text size-6" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" aria-label={t("attach")}>
        {options.map(({ key, label, icon: Icon, onSelect }) => (
          <DropdownMenuItem key={key} onSelect={onSelect}>
            <Icon aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
