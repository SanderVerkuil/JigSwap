"use client";

// Thread header quick links (message-center redesign spec §5): profile,
// exchange and puzzle, each only when the server marks it reachable. Inline
// ghost buttons from md up; one overflow menu below md.
import { Image } from "@/compat/image";
import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeftRight,
  ChevronDown,
  MoreVertical,
  Puzzle,
  User,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "use-intl";
import {
  contextCopyHref,
  threadQuickLinks,
  type InboxContextCopy,
  type InboxThread,
  type ThreadQuickLink,
} from "./format";

type SingleLink = Extract<ThreadQuickLink, { href: string }>;

const LINK_META: Record<
  SingleLink["kind"],
  { icon: LucideIcon; label: string }
> = {
  profile: { icon: User, label: "goToProfile" },
  exchange: { icon: ArrowLeftRight, label: "goToExchange" },
  puzzle: { icon: Puzzle, label: "goToPuzzle" },
};

export function ThreadQuickLinks({ thread }: { thread: InboxThread }) {
  const t = useTranslations("messages");
  const links = threadQuickLinks(thread);
  if (links.length === 0) return null;
  const single = links.filter((link): link is SingleLink => "href" in link);
  const puzzles = links.find((link) => link.kind === "puzzles")?.copies;
  // Three or more header items (an exchange with a partner profile and a
  // puzzle menu) would squeeze the thread title to a few characters on the
  // desktop pane: show them icon-only then, named by aria-label + tooltip.
  const compact = links.length >= 3;

  return (
    <>
      <div className="hidden shrink-0 gap-1 md:flex">
        {single.map(({ kind, href }) => {
          const { icon: Icon, label } = LINK_META[kind];
          return (
            <Button
              key={kind}
              asChild
              variant="ghost"
              size={compact ? "icon" : "sm"}
            >
              <Link
                href={href}
                aria-label={compact ? t(label) : undefined}
                title={compact ? t(label) : undefined}
              >
                <Icon aria-hidden />
                {!compact && t(label)}
              </Link>
            </Button>
          );
        })}
        {puzzles && (
          // Several puzzles: one "Puzzles (N)" menu rather than N buttons.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={
                  compact
                    ? t("puzzlesMenu", { count: puzzles.length })
                    : undefined
                }
                title={
                  compact
                    ? t("puzzlesMenu", { count: puzzles.length })
                    : undefined
                }
              >
                <Puzzle aria-hidden />
                {compact
                  ? puzzles.length
                  : t("puzzlesMenu", { count: puzzles.length })}
                <ChevronDown aria-hidden className="size-3.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {puzzles.map((copy) => (
                <PuzzleMenuItem key={copy.copyId} copy={copy} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="shrink-0 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t("threadActions")}
            >
              <MoreVertical className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[min(18rem,calc(100vw-1rem))]"
          >
            {single.map(({ kind, href }) => {
              const { icon: Icon, label } = LINK_META[kind];
              return (
                // The menu only exists below md: keep each item a 44px target.
                <DropdownMenuItem key={kind} asChild className="min-h-11">
                  <Link href={href}>
                    <Icon aria-hidden />
                    {t(label)}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            {puzzles && (
              // A labelled group in the same menu, not a submenu: submenus
              // open sideways (no room at 390px) and need an extra tap.
              <DropdownMenuGroup>
                {single.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t("puzzlesGroup")}
                </DropdownMenuLabel>
                {puzzles.map((copy) => (
                  <PuzzleMenuItem
                    key={copy.copyId}
                    copy={copy}
                    className="min-h-11"
                  />
                ))}
              </DropdownMenuGroup>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

// One puzzle in a menu: small cover (or the puzzle glyph) and its title.
function PuzzleMenuItem({
  copy,
  className,
}: {
  copy: InboxContextCopy;
  className?: string;
}) {
  return (
    <DropdownMenuItem asChild className={className}>
      <Link href={contextCopyHref(copy)}>
        <span className="bg-muted relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
          {copy.coverUrl ? (
            <Image src={copy.coverUrl} alt="" fill className="object-cover" />
          ) : (
            <Puzzle className="text-muted-foreground size-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0 truncate">{copy.title}</span>
      </Link>
    </DropdownMenuItem>
  );
}
