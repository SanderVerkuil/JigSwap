"use client";

// Thread header quick links (message-center redesign spec §5): profile,
// exchange and puzzle, each only when the server marks it reachable. Inline
// ghost buttons from md up; one overflow menu below md.
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
  Puzzle,
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
  puzzle: { icon: Puzzle, label: "goToPuzzle" },
};

export function ThreadQuickLinks({ thread }: { thread: InboxThread }) {
  const t = useTranslations("messages");
  const links = threadQuickLinks(thread);
  if (links.length === 0) return null;

  return (
    <>
      <div className="hidden shrink-0 gap-1 md:flex">
        {links.map(({ kind, href }) => {
          const { icon: Icon, label } = LINK_META[kind];
          return (
            <Button key={kind} asChild variant="ghost" size="sm">
              <Link href={href}>
                <Icon aria-hidden />
                {t(label)}
              </Link>
            </Button>
          );
        })}
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
          <DropdownMenuContent align="end">
            {links.map(({ kind, href }) => {
              const { icon: Icon, label } = LINK_META[kind];
              return (
                <DropdownMenuItem key={kind} asChild>
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
