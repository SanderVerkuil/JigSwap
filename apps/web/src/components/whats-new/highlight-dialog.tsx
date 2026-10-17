"use client";

import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { gateway } from "@/gateway";
import { safeStorage } from "@/lib/safe-storage";
import { cn } from "@/lib/utils";
import type { WhatsNewEntry } from "@/whats-new/types";
import { useConvexMutation } from "@convex-dev/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { ArrowRight, Compass, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { CategoryChip } from "./category-chip";
import { WHATS_NEW_ENTRIES } from "./entries";
import { canOpenHighlight, contentFor, pickHighlightEntry } from "./logic";
import { isAnyDialogOpen, isSurfaceBusy } from "./surface-busy";
import { useTourLauncher } from "./tour-launcher";
import { useWhatsNewState } from "./use-whats-new-state";

// "At most one per session" is client session state (spec §A3), not persisted on the server.
const SHOWN_KEY = "jigswap.whatsNew.highlightShown";

// Lets the route settle (and page-load focus land) before the modal takes focus (Part B §4.1).
const OPEN_DELAY_MS = 600;

// The one-time highlight modal: the newest unread `highlight` entry, at most once per session,
// never on /whats-new, and only when no other dialog, prompt or tour is on screen (spec §A6). When
// something is busy it does not queue: it tries again after the next route change. Mounted inside
// the dashboard's prompt providers so the surface-busy signal covers them.
export function WhatsNewHighlight() {
  const pathname = usePathname();
  const { unreadIds } = useWhatsNewState();
  const candidateId = unreadIds
    ? pickHighlightEntry(WHATS_NEW_ENTRIES, unreadIds)?.id
    : undefined;
  const [entry, setEntry] = useState<WhatsNewEntry | null>(null);
  const markSeen = useConvexMutation(gateway.whatsNew.markSeen);

  useEffect(() => {
    if (!candidateId) return;
    const timer = window.setTimeout(() => {
      const open = canOpenHighlight({
        pathname,
        shownThisSession: safeStorage.getItem("session", SHOWN_KEY) === "1",
        hasCandidate: true,
        surfaceBusy: isSurfaceBusy(),
        dialogOpen: isAnyDialogOpen(),
      });
      if (!open) return;
      safeStorage.setItem("session", SHOWN_KEY, "1");
      setEntry(WHATS_NEW_ENTRIES.find((e) => e.id === candidateId) ?? null);
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, candidateId]);

  // Every close (Esc, X, overlay, "Maybe later", any action) means "seen" (Part B §4.3).
  const close = () => {
    if (!entry) return;
    setEntry(null);
    markSeen({ ids: [entry.id] }).catch((error: unknown) =>
      console.error("Failed to mark update seen:", error),
    );
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && close()}>
      {entry && <HighlightContent entry={entry} onClose={close} />}
    </Dialog>
  );
}

function HighlightContent({
  entry,
  onClose,
}: {
  entry: WhatsNewEntry;
  onClose: () => void;
}) {
  const t = useTranslations("whatsNew");
  const content = contentFor(entry, useLocale());
  const { startTour } = useTourLauncher();
  const contentRef = useRef<HTMLDivElement>(null);
  const tour = entry.tour;
  const cta =
    entry.ctaTo && content.ctaLabel
      ? { to: entry.ctaTo, label: content.ctaLabel }
      : undefined;
  const fullWidth = "w-full sm:w-auto";
  const primaryLook = cn(
    fullWidth,
    "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white",
  );

  // Primary: the tour, else the CTA, else "Read more" on the page. Actions close the dialog first,
  // then navigate or start the tour, so focus is not restored to a node about to unmount.
  const primary = tour ? (
    <Button
      data-whats-new-primary
      className={primaryLook}
      onClick={() => {
        onClose();
        startTour(tour, { returnFocus: null });
      }}
    >
      <Compass aria-hidden />
      {t("tour.take")}
    </Button>
  ) : (
    <Button asChild data-whats-new-primary className={primaryLook}>
      {cta ? (
        <Link href={cta.to} onClick={onClose}>
          {cta.label}
        </Link>
      ) : (
        <RouterLink
          to="/whats-new"
          hash={`entry-${entry.id}`}
          onClick={onClose}
        >
          {t("readMore")}
        </RouterLink>
      )}
    </Button>
  );

  return (
    <DialogContent
      ref={contentRef}
      className={cn(
        "max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 motion-reduce:animate-none sm:max-w-md",
        entry.image &&
          "[&>[data-slot=dialog-close]]:bg-background/80 [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:p-1 [&>[data-slot=dialog-close]]:backdrop-blur-sm",
      )}
      onOpenAutoFocus={(event) => {
        // Focus the primary action, not the close X Radix would pick first (Part B §4.3).
        event.preventDefault();
        contentRef.current
          ?.querySelector<HTMLElement>("[data-whats-new-primary]")
          ?.focus();
      }}
    >
      {entry.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.image}
          alt={content.imageAlt ?? ""}
          className="bg-muted aspect-video w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="bg-jigsaw-primary-tint flex h-28 items-center justify-center"
        >
          <span className="bg-card text-jigsaw-primary flex size-14 items-center justify-center rounded-2xl shadow-sm">
            <Sparkles className="size-7" />
          </span>
        </div>
      )}
      <div className="flex flex-col gap-2 p-6 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-[11px] tracking-[0.09em] uppercase">
            {t("modal.eyebrow")}
          </span>
          <CategoryChip category={entry.category} />
        </div>
        <DialogTitle className="font-heading text-left text-2xl leading-tight font-semibold">
          {content.title}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground text-left">
          {content.summary}
        </DialogDescription>
      </div>
      {/* flex-col-reverse on mobile: the primary ends up on top, "See all" at the bottom. */}
      <DialogFooter className="bg-muted/40 border-t px-6 py-4">
        <Button
          asChild
          variant="link"
          size="sm"
          className={cn(fullWidth, "sm:mr-auto")}
        >
          <Link href="/whats-new" onClick={onClose}>
            {t("seeAll")}
          </Link>
        </Button>
        <Button variant="ghost" className={fullWidth} onClick={onClose}>
          {t("modal.later")}
        </Button>
        {tour && cta && (
          <Button asChild variant="outline" className={fullWidth}>
            <Link href={cta.to} onClick={onClose}>
              {cta.label}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
        {primary}
      </DialogFooter>
    </DialogContent>
  );
}
