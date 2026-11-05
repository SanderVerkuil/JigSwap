"use client";

import { useReturnFocus } from "@/components/ui/use-return-focus";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const t = useTranslations("common");
  // Most dialogs open from state, not a DialogTrigger: give focus back to what opened them.
  const returnFocus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      {/* Capped at the visible viewport (100dvh follows the phone keyboard and landscape) and
          scrolling inside itself, so a tall dialog never loses its top or its actions. Dialogs
          that lay out their own scroll area override max-h/overflow through className. The
          scroll padding keeps a focused field clear of the sticky DialogFooter: the browser
          scrolls a field out from under it (stacked buttons below sm, one row from sm). */}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none! data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 scroll-pb-32 overflow-y-auto overscroll-contain rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg sm:scroll-pb-20",
          className,
        )}
        {...props}
        {...returnFocus}
      >
        {children}
        {/* A 36px target (44px on touch) centred on where the 16px icon always sat: 24px from
            the top-right corner. */}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:bg-accent hover:text-accent-foreground absolute top-1.5 right-1.5 grid size-9 place-items-center rounded-md opacity-100 transition-colors pointer-coarse:top-0.5 pointer-coarse:right-0.5 pointer-coarse:size-11 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t("close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      // A long title leaves room for the close button: on both sides below sm, where the header
      // centres it, so it stays centred.
      className={cn(
        "flex flex-col gap-2 text-center sm:text-left [&>[data-slot=dialog-title]]:max-sm:px-8 [&>[data-slot=dialog-title]]:sm:pr-8",
        className,
      )}
      {...props}
    />
  );
}

// Sticky so the actions stay in view while a tall dialog scrolls. A sticky box stops short of the
// scroller's padding (24px above the dialog's bottom here), so a background-coloured shadow, level
// with the footer's top, covers that strip and the side gutters: the scrolled body never shows
// around the buttons. Box shadows add no scroll area, so dialogs without the padding are unaffected.
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-background sticky bottom-0 flex flex-col-reverse gap-2 shadow-[0_1.5rem_0_1.5rem_var(--background)] sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
