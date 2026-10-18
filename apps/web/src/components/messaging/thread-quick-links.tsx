"use client";

// Thread header quick links (message-center redesign spec §5): the partner's
// profile and the exchange, each only when the server marks it reachable.
// Inline ghost buttons from md up. The header's one overflow menu lists the
// links below md and, at every width, the actions on the partner (Block) when
// the viewer may know who they are and hasn't blocked them (the composer slot's
// banner then offers Unblock). The puzzles are the header's cover stack
// (thread-puzzle-stack.tsx).
import { Link } from "@/compat/link";
import { MemberActionsMenu } from "@/components/social/member-actions-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
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
import { threadPartner } from "./thread-partner";

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
  const displayName = useMemberDisplayName();
  const links = threadQuickLinks(thread);
  // Whom the safety items act on: none once the viewer blocked them.
  const actOn = thread.blocked === "byMe" ? null : threadPartner(thread);
  if (links.length === 0 && !actOn) return null;

  // The links as menu items; the menu shows them only below md, where the
  // inline buttons are hidden. Each item stays a 44px target there.
  const linkItems = links.map(({ kind, href }) => {
    const { icon: Icon, label } = LINK_META[kind];
    return (
      <DropdownMenuItem key={kind} asChild className="min-h-11 md:hidden">
        <Link href={href}>
          <Icon aria-hidden />
          {t(label)}
        </Link>
      </DropdownMenuItem>
    );
  });

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
      {/* One overflow menu. The puzzles are not listed here — the header's
          cover stack already opens them. */}
      {actOn ? (
        <MemberActionsMenu
          memberId={actOn._id as Id<"users">}
          name={displayName(actOn)}
          label={t("threadActions")}
          icon={MoreVertical}
        >
          {linkItems.length > 0 && (
            <>
              {linkItems}
              <DropdownMenuSeparator className="md:hidden" />
            </>
          )}
        </MemberActionsMenu>
      ) : (
        // Nothing but the links to offer: the menu is only needed below md.
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
            <DropdownMenuContent align="end">{linkItems}</DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  );
}
