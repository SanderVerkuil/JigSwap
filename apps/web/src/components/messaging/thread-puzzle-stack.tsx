"use client";

// The puzzles a conversation is about, in the thread header next to the other
// member's name (desktop and phone). Several puzzles: a stack of covers that
// is itself the trigger of the puzzle menu (thumb, title, whose copy). One
// puzzle: a single cover linking straight to it — a one-item menu would just
// be an extra tap, and the tooltip already says whose copy it is.
//
// Hovering a cover separates only that cover — the ones before it stay stacked
// together, the ones after it too — so sweeping the pointer across moves the
// gap; the hovered cover lifts and shows "<title> · <whose copy>". Keyboard
// focus on the trigger acts like hovering the first cover (Enter/Space/Down
// open the menu, which lists every puzzle with its owner — so no arrow-key
// browsing of covers on the trigger itself).
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Puzzle } from "lucide-react";
import { useId, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import {
  CoverTile,
  CoverTooltipContent,
  CoverTooltipProvider,
} from "./cover-stack";
import {
  contextCopyHref,
  copyOwnerHint,
  coverStackSummary,
  type InboxContextCopy,
  type InboxThread,
} from "./format";

// Covers drawn before the "+N" counter (the backend sends at most 10).
const VISIBLE = 5;
const VISIBLE_MOBILE = 3;

// Geometry (px) behind the reserved width: 24px tiles overlapping by 12px
// (-ml-3); an opened gap turns that into 4px apart (ml-1), i.e. 16px wider;
// the "+N" counter is ~24px plus its 4px margin.
const COVER_PX = 24;
const OVERLAP_PX = 12;
const GAP_GROWTH_PX = 16;
const COUNTER_PX = 28;

// Stacking order, front to back (static classes so Tailwind sees them).
const Z_INDEX = ["z-[5]", "z-[4]", "z-[3]", "z-[2]", "z-[1]"];

const TRIGGER_CLASS =
  "focus-visible:ring-ring flex h-11 shrink-0 items-center rounded-md px-1.5 outline-none hover:bg-muted/60 focus-visible:ring-2 md:h-9";

export function ThreadPuzzleStack({ thread }: { thread: InboxThread }) {
  const t = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const copies = thread.contextCopies;
  if (copies.length === 0) return null;
  const describe = (copy: InboxContextCopy) =>
    `${copy.title} · ${copyOwnerHint(copy.owner, thread.subject.otherMember, t, displayName)}`;

  return (
    <CoverTooltipProvider>
      {copies.length === 1 ? (
        <SingleCover copy={copies[0]} describe={describe} />
      ) : (
        <CoverMenu
          copies={copies}
          describe={describe}
          ownerHint={(copy) =>
            copyOwnerHint(
              copy.owner,
              thread.subject.otherMember,
              t,
              displayName,
            )
          }
        />
      )}
    </CoverTooltipProvider>
  );
}

function SingleCover({
  copy,
  describe,
}: {
  copy: InboxContextCopy;
  describe: (copy: InboxContextCopy) => string;
}) {
  const t = useTranslations("messages");
  const [hovered, setHovered] = useState(false);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  return (
    <TooltipPrimitive.Root
      open={hovered || keyboardFocused}
      onOpenChange={setHovered}
    >
      <TooltipPrimitive.Trigger asChild>
        <Link
          href={contextCopyHref(copy)}
          aria-label={t("goToPuzzleNamed", { title: copy.title })}
          onFocus={(event) =>
            setKeyboardFocused(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setKeyboardFocused(false)}
          className={cn(TRIGGER_CLASS, "group")}
        >
          <span
            aria-hidden
            className="flex transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:duration-0"
          >
            <CoverTile copy={copy} />
          </span>
        </Link>
      </TooltipPrimitive.Trigger>
      <CoverTooltipContent>{describe(copy)}</CoverTooltipContent>
    </TooltipPrimitive.Root>
  );
}

function CoverMenu({
  copies,
  describe,
  ownerHint,
}: {
  copies: readonly InboxContextCopy[];
  describe: (copy: InboxContextCopy) => string;
  ownerHint: (copy: InboxContextCopy) => string;
}) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const summaryId = useId();
  // Phones keep the header compact: fewer covers, and no hover to make
  // room for.
  const isMobile = useIsMobile();
  const visible = copies.slice(0, isMobile ? VISIBLE_MOBILE : VISIBLE);
  const rest = copies.length - visible.length;
  // From md up, reserve the widest hovered layout (a 16px gap before and
  // after the active cover; overlap 12px → 4px apart), so opening a gap never
  // shifts the stack or squeezes the title — a shift would slide the next
  // cover under a still pointer.
  const reservedWidth = isMobile
    ? undefined
    : COVER_PX +
      (visible.length - 1) * (COVER_PX - OVERLAP_PX) +
      Math.min(2, visible.length - 1) * GAP_GROWTH_PX +
      (rest > 0 ? COUNTER_PX : 0);

  const [menuOpen, setMenuOpen] = useState(false);
  // The cover under a mouse pointer. Set only when the pointer enters a
  // cover and cleared only when it leaves the whole stack — moving through a
  // gap keeps the current cover, so the layout shift can't make it flicker.
  const [pointed, setPointed] = useState<number | null>(null);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const active = pointed ?? (keyboardFocused ? 0 : null);
  // Which cover's name tooltip Radix has opened (it applies the delays).
  const [tipOpen, setTipOpen] = useState<number | null>(null);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        className={TRIGGER_CLASS}
        aria-label={t("puzzlesMenu", { count: copies.length })}
        aria-describedby={summaryId}
        onPointerLeave={() => setPointed(null)}
        onFocus={(event) =>
          setKeyboardFocused(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setKeyboardFocused(false)}
      >
        <span id={summaryId} className="sr-only">
          {coverStackSummary(
            copies.map((copy) => copy.title),
            locale,
            t,
          )}
        </span>
        <span
          aria-hidden
          className="flex items-center"
          style={{ minWidth: reservedWidth }}
        >
          {visible.map((copy, index) => {
            // A gap opens before and after the active cover only.
            const separated =
              active !== null && (index === active || index === active + 1);
            const lifted = index === active;
            // Tooltips never compete with the open menu.
            const open =
              !menuOpen &&
              (tipOpen === index ||
                (tipOpen === null && keyboardFocused && index === 0));
            return (
              <TooltipPrimitive.Root
                key={copy.copyId}
                open={open}
                onOpenChange={(next) =>
                  setTipOpen((current) =>
                    next ? index : current === index ? null : current,
                  )
                }
              >
                <TooltipPrimitive.Trigger asChild>
                  <span
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse") setPointed(index);
                    }}
                    className={cn(
                      "relative flex shrink-0 transition-[margin,translate] duration-200 ease-out motion-reduce:transition-none motion-reduce:duration-0",
                      lifted ? "z-10 -translate-y-0.5" : Z_INDEX[index],
                      index > 0 && (separated ? "ml-1" : "-ml-3"),
                    )}
                  >
                    <CoverTile
                      copy={copy}
                      // Behind the card in front, only the right half shows.
                      glyphShifted={index > 0 && !separated}
                    />
                  </span>
                </TooltipPrimitive.Trigger>
                <CoverTooltipContent>{describe(copy)}</CoverTooltipContent>
              </TooltipPrimitive.Root>
            );
          })}
          {rest > 0 && (
            // Beside the stack, never under it, so "+N" stays readable.
            <span className="bg-muted text-muted-foreground ml-1 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[5px] px-1 text-[11px] font-semibold tabular-nums">
              +{rest}
            </span>
          )}
        </span>
      </DropdownMenuTrigger>
      {/* Wide enough for "Exemplaar van <long name>"; longer text wraps. */}
      <DropdownMenuContent
        align="start"
        className="w-auto max-w-[min(26rem,calc(100vw-1rem))] min-w-72"
      >
        {copies.map((copy) => (
          <PuzzleMenuItem
            key={copy.copyId}
            copy={copy}
            hint={ownerHint(copy)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// One puzzle in the menu: thumb, title and whose copy it is, wrapping rather
// than truncating; at least 44px tall for touch.
function PuzzleMenuItem({
  copy,
  hint,
}: {
  copy: InboxContextCopy;
  hint: string;
}) {
  return (
    <DropdownMenuItem asChild className="min-h-11">
      <Link href={contextCopyHref(copy)}>
        <span className="bg-muted relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
          {copy.coverUrl ? (
            <Image src={copy.coverUrl} alt="" fill className="object-cover" />
          ) : (
            <Puzzle className="text-muted-foreground size-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block break-words">{copy.title}</span>
          <span className="text-muted-foreground block text-xs break-words">
            {hint}
          </span>
        </span>
      </Link>
    </DropdownMenuItem>
  );
}
