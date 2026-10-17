"use client";

import { getRouteMeta } from "@/components/dashboard-layout/route-meta";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";
import { dockSide, tourNextLabel, type TourSnapshot } from "./controller";
import { stepMessageKeys } from "./definitions";

type RunningSnapshot = Extract<
  TourSnapshot<HTMLElement>,
  { status: "running" }
>;

export interface TourLayerActions {
  onNext: () => void;
  onBack: () => void;
  onPause: () => void;
  onKey: (key: string) => boolean;
}

/** `shell.pages.<key>.title` for a route, for "Next: Library" and "Opening Library…". */
export function usePageTitle(): (route: string) => string {
  const t = useTranslations("shell.pages");
  return (route) => {
    const key = getRouteMeta(route)?.pageKey;
    return key ? t(`${key}.title`) : route;
  };
}

/**
 * The step card's content (spec Part B §5.3), shared by the desktop popover and the mobile/centred
 * card. Pure presentation: no positioning, no focus trap.
 */
export function TourCardBody({
  ids,
  titleRef,
  stepLabel,
  title,
  body,
  pendingLabel,
  index,
  total,
  nextLabel,
  isLast,
  touch,
  onBack,
  onNext,
  onClose,
}: {
  ids: { eyebrow: string; title: string; body: string };
  titleRef?: RefObject<HTMLHeadingElement | null>;
  stepLabel: string;
  title: string;
  body: string;
  /** Set while the step's page or anchor is loading: replaces the body with a spinner line. */
  pendingLabel?: string;
  index: number;
  total: number;
  nextLabel: string;
  isLast: boolean;
  /** Mobile: 44px touch targets. */
  touch: boolean;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("tour");
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <span
          id={ids.eyebrow}
          className="text-muted-foreground font-mono text-[11px] tracking-[0.09em] uppercase"
        >
          {stepLabel}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn("-mt-1 -mr-1", touch ? "size-11" : "size-7")}
          aria-label={t("end")}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <h2
        id={ids.title}
        ref={titleRef}
        tabIndex={-1}
        className="font-heading px-4 pt-1 text-lg leading-snug font-semibold focus-visible:outline-none"
      >
        {title}
      </h2>
      <p id={ids.body} className="text-muted-foreground px-4 pt-1 text-sm">
        {pendingLabel ? (
          <span className="flex items-center gap-2">
            <Loader2
              aria-hidden
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {pendingLabel}
          </span>
        ) : (
          body
        )}
      </p>
      <div aria-hidden className="flex items-center gap-1.5 px-4 pt-3 pb-4">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-[width] duration-200 motion-reduce:transition-none",
              i === index
                ? "bg-primary w-4"
                : i < index
                  ? "bg-primary/40 w-1.5"
                  : "bg-border w-1.5",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5">
        {index > 0 ? (
          <Button
            variant="ghost"
            size={touch ? "default" : "sm"}
            className={cn(touch && "min-h-11")}
            onClick={onBack}
          >
            <ChevronLeft aria-hidden />
            {t("back")}
          </Button>
        ) : (
          <span />
        )}
        <Button
          size={touch ? "default" : "sm"}
          className={cn(
            "bg-jigsaw-primary hover:bg-jigsaw-primary/90 text-white",
            touch && "min-h-11",
          )}
          onClick={onNext}
        >
          {nextLabel}
          {isLast ? <Check aria-hidden /> : <ChevronRight aria-hidden />}
        </Button>
      </div>
    </>
  );
}

/** Live viewport rect of `target`, re-measured on scroll, resize and target resize. */
function useTargetRect(target: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!target) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setRect(target.getBoundingClientRect()),
      );
    };
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener("scroll", measure, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [target]);
  return target ? rect : null;
}

// Below Tailwind's `md`: the docked card instead of the anchored popover (spec Part B §5.5). Read
// synchronously (not after an effect like useIsMobile) so a tour started on a phone never mounts
// the desktop popover for a frame. The server snapshot is never used: the layer only renders
// while a tour runs, which starts from a click.
const BELOW_MD = "(max-width: 767px)";
const subscribeBelowMd = (onChange: () => void) => {
  const query = window.matchMedia(BELOW_MD);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
function useBelowMd(): boolean {
  return useSyncExternalStore(
    subscribeBelowMd,
    () => window.matchMedia(BELOW_MD).matches,
    () => false,
  );
}

const SPOTLIGHT_PAD = 6;

/** Click shield + dim (spotlight cut-out when a target is lit), spec Part B §5.2. */
function TourBackdrop({ rect }: { rect: DOMRect | null }) {
  return createPortal(
    <div aria-hidden data-tour-overlay="">
      <div className="pointer-events-auto fixed inset-0 z-50" />
      {rect ? (
        <div
          className="ring-primary ring-offset-background pointer-events-none fixed z-50 rounded-lg shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-2 ring-offset-2 transition-[top,left,width,height] duration-300 ease-out forced-colors:shadow-none forced-colors:outline-2 forced-colors:outline-[Highlight] motion-reduce:transition-none"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-50 bg-black/50" />
      )}
    </div>,
    document.body,
  );
}

/** The running tour: backdrop plus the step card, anchored (desktop) or docked/centred. */
export function TourLayer({
  snapshot,
  actions,
}: {
  snapshot: RunningSnapshot;
  actions: TourLayerActions;
}) {
  const t = useTranslations();
  const pageTitle = usePageTitle();
  const mobile = useBelowMd();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const uid = useId();
  const ids = {
    eyebrow: `${uid}-eyebrow`,
    title: `${uid}-title`,
    body: `${uid}-body`,
  };

  const { tourId, index, total, step, phase, target } = snapshot;
  const rect = useTargetRect(phase === "shown" ? target : null);
  const anchorRef = useMemo(() => ({ current: target }), [target]);

  // Move focus to the step title on every step and phase change, so screen readers hear
  // "Step 2 of 5, <title>" (spec Part B §5.4).
  const stepKey = `${tourId}:${index}:${phase}`;
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [stepKey]);

  const keys = stepMessageKeys(tourId, step.id);
  const next = tourNextLabel(snapshot);

  const body = (
    <TourCardBody
      ids={ids}
      titleRef={titleRef}
      stepLabel={t("tour.stepOf", { step: index + 1, total })}
      title={t(keys.title)}
      body={t(keys.body)}
      pendingLabel={
        phase === "pending"
          ? t("tour.opening", { page: pageTitle(step.route) })
          : undefined
      }
      index={index}
      total={total}
      nextLabel={
        next.kind === "done"
          ? t("tour.done")
          : next.kind === "nextOnPage"
            ? t("tour.nextOnPage", { page: pageTitle(next.route) })
            : t("tour.next")
      }
      isLast={next.kind === "done"}
      touch={mobile}
      onBack={actions.onBack}
      onNext={actions.onNext}
      onClose={actions.onPause}
    />
  );

  const a11y = {
    "aria-modal": true,
    "aria-labelledby": `${ids.eyebrow} ${ids.title}`,
    "aria-describedby": ids.body,
    "aria-roledescription": t("tour.roleDescription"),
  } as const;
  const handlers = {
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      titleRef.current?.focus({ preventScroll: true });
    },
    // The provider restores focus to the element that started the tour.
    onCloseAutoFocus: (event: Event) => event.preventDefault(),
    onEscapeKeyDown: (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      event.preventDefault();
      actions.onPause();
    },
    // The shield owns outside clicks: they must not end the tour.
    onInteractOutside: (event: Event) => event.preventDefault(),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape") return; // handled by onEscapeKeyDown
      if (actions.onKey(event.key)) event.preventDefault();
    },
  };

  let card: ReactNode;
  if (phase === "shown" && target && !mobile) {
    card = (
      <Popover open modal>
        <PopoverAnchor virtualRef={anchorRef} />
        <PopoverContent
          side={step.side ?? "bottom"}
          align={step.align ?? "start"}
          sideOffset={12}
          collisionPadding={16}
          className="z-[51] w-80 p-0 motion-reduce:animate-none"
          {...a11y}
          {...handlers}
        >
          {body}
          <PopoverArrow width={14} height={7} className="fill-popover" />
        </PopoverContent>
      </Popover>
    );
  } else {
    // Docked while a target is lit (bottom until its rect is measured); centred otherwise.
    const docked =
      phase === "shown"
        ? rect
          ? dockSide(rect, window.innerHeight)
          : "bottom"
        : undefined;
    card = (
      <DialogPrimitive.Root open modal>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            className={cn(
              "bg-card text-card-foreground fixed z-[51] border shadow-lg outline-hidden",
              docked
                ? cn(
                    "inset-x-3 rounded-[20px] motion-safe:animate-in motion-safe:fade-in-0",
                    docked === "bottom"
                      ? "bottom-[calc(12px+env(safe-area-inset-bottom))] motion-safe:slide-in-from-bottom-4"
                      : "top-[calc(68px+env(safe-area-inset-top))] motion-safe:slide-in-from-top-4",
                  )
                : "top-1/2 left-1/2 w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl",
            )}
            {...a11y}
            {...handlers}
          >
            {body}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <>
      <TourBackdrop rect={phase === "shown" ? rect : null} />
      {card}
    </>
  );
}
