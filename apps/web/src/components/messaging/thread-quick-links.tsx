"use client";

// Thread header quick links (message-center redesign spec §5): the partner's
// profile and the exchange, each only when the server marks it reachable.
// Inline ghost buttons from md up; one overflow menu below md. The puzzles are
// the header's cover stack (thread-puzzle-stack.tsx).
import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeftRight,
  MoreVertical,
  User,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "use-intl";
import {
  threadQuickLinks,
  type InboxThread,
  type ThreadQuickLink,
} from "./format";

const LINK_META: Record<
  ThreadQuickLink["kind"],
  { icon: LucideIcon; label: string }
> = {
  profile: { icon: User, label: "goToProfile" },
  exchange: { icon: ArrowLeftRight, label: "goToExchange" },
};

export function ThreadQuickLinks({
  thread,
  compact,
}: {
  thread: InboxThread;
  // Icon-only on desktop, named by aria-label + tooltip, when the header also
  // carries the puzzle stack and both links (an exchange) — otherwise the
  // thread title would be squeezed to a few characters.
  compact: boolean;
}) {
  const t = useTranslations("messages");
  const links = threadQuickLinks(thread);
  if (links.length === 0) return null;

  return (
    <>
      <div className="hidden shrink-0 gap-1 md:flex">
        {links.map(({ kind, href }) => {
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
      </div>
      {/* Phones: the links in one overflow menu. The puzzles are not listed
          here — the header's cover stack already opens them. */}
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
          <DropdownMenuContent align="end">
            {links.map(({ kind, href }) => {
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
