"use client";

// A circle row's member avatars, stacked like the thread header's puzzle
// covers (thread-puzzle-stack.tsx): each avatar overlaps the next, and the
// active one comes fully into view — a gap opens before and after it while the
// avatars on either side stay stacked together — lifts, and names itself in a
// tooltip.
//
// Unlike the puzzle stack (one menu trigger), there is no menu to open here,
// so every avatar is its own button: Tab moves through them and keyboard
// focus reveals that avatar; a mouse reveals the avatar under the pointer
// (moving through a gap keeps it); a tap toggles the avatar's name, since
// touch has no hover.
import {
  CoverTooltipContent,
  CoverTooltipProvider,
} from "@/components/messaging/cover-stack";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "use-intl";

export interface StackMember {
  key: string;
  // Already resolved through the identity projection (never an email).
  name: string;
  avatar?: string;
  // The avatar fallback (the member's initial, or a person glyph).
  fallback: ReactNode;
}

// Avatars drawn before the "+N" counter: five from lg up; below that the row
// is tight (the puzzle stack also draws fewer on narrow screens), so three.
const VISIBLE = 5;
const VISIBLE_NARROW = 3;

// Geometry (px) behind the reserved width: 32px avatars overlapping by 10px
// (-ml-2.5); an opened gap turns that into 4px apart (ml-1), i.e. 14px wider;
// the "+N" counter is 32px plus its 4px margin.
const AVATAR_PX = 32;
const OVERLAP_PX = 10;
const GAP_GROWTH_PX = 14;
const COUNTER_PX = 36;

// Stacking order, front to back (static classes so Tailwind sees them).
const Z_INDEX = ["z-[5]", "z-[4]", "z-[3]", "z-[2]", "z-[1]"];

export function CircleAvatarStack({
  circleName,
  members,
}: {
  circleName: string;
  members: readonly StackMember[];
}) {
  const t = useTranslations("circles");
  const visible = members.slice(0, VISIBLE);
  const rest = members.length - visible.length;
  const restNarrow = members.length - Math.min(members.length, VISIBLE_NARROW);
  // From lg up, reserve the widest revealed layout so opening a gap never
  // shifts the row — a shift would slide the next avatar under a still
  // pointer. Narrower rows have no room to spare for it.
  const reservedWidth =
    AVATAR_PX +
    (visible.length - 1) * (AVATAR_PX - OVERLAP_PX) +
    Math.min(2, visible.length - 1) * GAP_GROWTH_PX +
    (rest > 0 ? COUNTER_PX : 0);

  // The avatar under a mouse pointer: set when the pointer enters an avatar,
  // cleared only when it leaves the whole stack.
  const [pointed, setPointed] = useState<number | null>(null);
  // The avatar with keyboard (focus-visible) focus.
  const [focused, setFocused] = useState<number | null>(null);
  // The avatar a touch/pen tap opened.
  const [tapped, setTapped] = useState<number | null>(null);
  // Which avatar's name tooltip Radix has opened (it applies the delays).
  const [tipOpen, setTipOpen] = useState<number | null>(null);
  // The last press: its pointer type (a tap vs a click or Enter) and whether
  // its avatar's name was showing — Radix closes it on pointerdown, before
  // the click that toggles it.
  const press = useRef<{ pointer: string; wasTapped: boolean } | null>(null);
  const active = pointed ?? focused ?? tapped;

  return (
    <CoverTooltipProvider>
      <div
        role="group"
        aria-label={t("avatarStackLabel", { circle: circleName })}
        className="flex items-center lg:min-w-(--stack-reserve)"
        style={{ "--stack-reserve": `${reservedWidth}px` } as CSSProperties}
        onPointerLeave={() => setPointed(null)}
      >
        {visible.map((member, index) => {
          // A gap opens before and after the active avatar only.
          const separated =
            active !== null && (index === active || index === active + 1);
          const lifted = index === active;
          return (
            <TooltipPrimitive.Root
              key={member.key}
              open={tipOpen === index || tapped === index}
              onOpenChange={(next) => {
                setTipOpen((current) =>
                  next ? index : current === index ? null : current,
                );
                if (!next) setTapped((c) => (c === index ? null : c));
              }}
            >
              <TooltipPrimitive.Trigger asChild>
                <button
                  type="button"
                  aria-label={member.name}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setPointed(index);
                  }}
                  onPointerDown={(event) => {
                    press.current = {
                      pointer: event.pointerType,
                      wasTapped: tapped === index,
                    };
                  }}
                  onClick={(event) => {
                    const last = press.current;
                    press.current = null;
                    if (last?.pointer === "touch" || last?.pointer === "pen") {
                      // Keep Radix from closing it again on click.
                      event.preventDefault();
                      setTapped(last.wasTapped ? null : index);
                    }
                  }}
                  onFocus={(event) =>
                    setFocused(
                      event.currentTarget.matches(":focus-visible")
                        ? index
                        : null,
                    )
                  }
                  onBlur={() => setFocused((c) => (c === index ? null : c))}
                  className={cn(
                    "focus-visible:ring-ring relative flex shrink-0 rounded-full transition-[margin,translate] duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:duration-0",
                    lifted ? "z-10 -translate-y-0.5" : Z_INDEX[index],
                    index > 0 && (separated ? "ml-1" : "-ml-2.5"),
                    index >= VISIBLE_NARROW && "hidden lg:flex",
                  )}
                >
                  <Avatar aria-hidden className="ring-card size-8 ring-2">
                    {member.avatar && (
                      <AvatarImage src={member.avatar} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {member.fallback}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </TooltipPrimitive.Trigger>
              <CoverTooltipContent>{member.name}</CoverTooltipContent>
            </TooltipPrimitive.Root>
          );
        })}
        {restNarrow > 0 && (
          <MoreCounter count={restNarrow} className="lg:hidden" />
        )}
        {rest > 0 && <MoreCounter count={rest} className="hidden lg:flex" />}
      </div>
    </CoverTooltipProvider>
  );
}

// "+N" beside the stack, never under it, so it stays readable.
function MoreCounter({
  count,
  className,
}: {
  count: number;
  className: string;
}) {
  const t = useTranslations("circles");
  return (
    <span
      role="img"
      aria-label={t("avatarStackMore", { count })}
      className={cn(
        "bg-muted text-muted-foreground ml-1 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
        className,
      )}
    >
      <span aria-hidden>+{count}</span>
    </span>
  );
}
