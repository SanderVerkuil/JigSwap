"use client";

// Landing page for a sidebar nav group (/library, /community, /admin): a
// launcher tile grid of the group's surfaces — violet-tint icon chip, title,
// 2-line description, hover chevron — per the content-width conformance
// design (tile grid deliberately chosen over a row directory so these pages
// feel like a "home" surface). Below sm, where the phone tabs open these hubs,
// the tiles become compact ~56px rows (chip, title, one-line description,
// chevron) so every page fits above the fold. Messages and Exchanges carry
// their live counts: a pill on the phone row, the full count in the link's
// name at every size. Driven entirely by the route-meta nav groups, so the IA
// stays defined in exactly one place.
import { Link } from "@/compat/link";
import { WhatsNewCountPill } from "@/components/whats-new/badges";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePendingRequestCount, useUnreadMessageCount } from "./nav-counts";
import { getNavGroup, type ShellGroupKey } from "./route-meta";

export function GroupLanding({ group }: { group: ShellGroupKey }) {
  const t = useTranslations("shell");
  const tMessages = useTranslations("messages");
  const { items } = getNavGroup(group);
  // Both reads are already live for the phone chrome; Convex dedupes them.
  const unreadMessages = useUnreadMessageCount();
  const pendingRequests = usePendingRequestCount();
  const countOf = (key: string): { value: number; label: string } | null => {
    if (key === "messages" && unreadMessages > 0) {
      return {
        value: unreadMessages,
        label: tMessages("unreadCount", { count: unreadMessages }),
      };
    }
    if (key === "exchanges" && pendingRequests > 0) {
      return {
        value: pendingRequests,
        label: t("landing.pendingRequests", { count: pendingRequests }),
      };
    }
    return null;
  };

  return (
    <div className="grid w-full gap-2 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
      {items.map((item) => {
        const count = countOf(item.key);
        return (
          <Link
            key={item.key}
            href={item.href}
            className="group flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-stretch sm:p-5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground sm:size-11">
              <item.icon className="size-[18px] sm:size-[19px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col sm:gap-1">
              <span className="font-medium text-foreground">
                {t(`pages.${item.key}.title`)}
              </span>
              <span className="line-clamp-1 text-sm text-muted-foreground sm:line-clamp-2">
                {t(`pages.${item.key}.description`)}
              </span>
              {count && <span className="sr-only">{count.label}</span>}
            </span>
            {count && (
              <span className="sm:hidden">
                <WhatsNewCountPill count={count.value} />
              </span>
            )}
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:self-end"
            />
          </Link>
        );
      })}
    </div>
  );
}
