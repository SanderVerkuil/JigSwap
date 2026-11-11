"use client";

// Landing page for a sidebar nav group (/library, /community, /admin): a
// launcher tile grid of the group's surfaces: bare icon, title, 2-line
// description and hover chevron, per the content-width conformance design (tile grid deliberately chosen over a row directory so these pages
// feel like a "home" surface). Below sm, where the phone tabs open these hubs,
// the tiles become compact rows (icon, title, up to two lines of description,
// chevron) so every page fits above the fold with the words that tell similar
// pages apart intact. Messages and Exchanges carry
// their live counts: a pill on the phone row, the full count in the link's
// name at every size. A tile can also carry a count of the work waiting behind
// it (`counts`, keyed by nav item; the admin hub passes its queue counts): a
// pill in the phone row and beside the icon from sm, announced with the title
// at every size. Driven entirely by the route-meta nav groups, so the IA stays
// defined in exactly one place.
import { Link } from "@/compat/link";
import { WhatsNewCountPill } from "@/components/whats-new/badges";
import { formatQueueCount, type QueueCount } from "@/lib/queue-count";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePendingRequestCount, useUnreadMessageCount } from "./nav-counts";
import { getNavGroup, type ShellGroupKey } from "./route-meta";

export function GroupLanding({
  group,
  counts,
}: {
  group: ShellGroupKey;
  counts?: Partial<Record<string, QueueCount>>;
}) {
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
        const waiting = counts?.[item.key];
        const showWaiting = waiting !== undefined && waiting.count > 0;
        return (
          <Link
            key={item.key}
            href={item.href}
            className="group relative flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-stretch sm:p-5"
          >
            <item.icon className="size-[18px] shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col sm:gap-1">
              <span className="font-semibold text-foreground">
                {t(`pages.${item.key}.title`)}
                {showWaiting && (
                  <span className="sr-only">
                    {", "}
                    {t("waitingCount", {
                      count: waiting.count,
                      capped: waiting.capped ? "yes" : "no",
                    })}
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-sm text-muted-foreground">
                {t(`pages.${item.key}.description`)}
              </span>
              {count && <span className="sr-only">{count.label}</span>}
            </span>
            {count && (
              <span className="sm:hidden">
                <WhatsNewCountPill count={count.value} />
              </span>
            )}
            {showWaiting && (
              // In the row below sm; from sm at the tile's top right, beside the icon.
              <span
                aria-hidden
                className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground tabular-nums sm:absolute sm:top-5 sm:right-5"
              >
                {formatQueueCount(waiting.count, waiting.capped)}
              </span>
            )}
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5 sm:self-end"
            />
          </Link>
        );
      })}
    </div>
  );
}
