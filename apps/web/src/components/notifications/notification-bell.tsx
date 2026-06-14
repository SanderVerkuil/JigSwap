"use client";

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { gateway } from "@/gateway";
import { useDateFnsLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  type NotificationRow,
  notificationAccent,
  notificationCopy,
  notificationHref,
  notificationIcon,
  notificationId,
} from "./notification-meta";

// How many recent rows the dropdown shows; the rest live on the full page.
const PREVIEW_COUNT = 6;

export function NotificationBell() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const dateLocale = useDateFnsLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Both reactive: the badge and the preview update live as events land. Gated on a signed-in
  // member so we never fire the query unauthenticated (and to mirror the existing "skip" pattern).
  const signedIn = Boolean(user?.id);
  const unread = useQuery(
    gateway.notifications.unreadCount,
    signedIn ? {} : "skip",
  );
  const notifications = useQuery(
    gateway.notifications.list,
    signedIn && open ? {} : "skip",
  ) as NotificationRow[] | undefined;

  const markRead = useMutation(gateway.notifications.markRead);
  const markAllRead = useMutation(gateway.notifications.markAllRead);

  const unreadCount = unread ?? 0;
  const preview = (notifications ?? []).slice(0, PREVIEW_COUNT);

  const handleOpen = async (row: NotificationRow) => {
    setOpen(false);
    // Optimistic-feeling: fire the read mutation but don't block navigation on it.
    if (!row.isRead) {
      markRead({ notificationId: notificationId(row) }).catch(() => {
        toast.error(t("markError"));
      });
    }
    const href = notificationHref(row);
    if (href) router.push(href);
  };

  const handleMarkAll = async () => {
    try {
      const count = await markAllRead({});
      toast.success(t("markedAllRead", { count: count ?? 0 }));
    } catch {
      toast.error(t("markError"));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t("bell")}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 justify-center rounded-full px-1 text-[10px] leading-none tabular-nums"
              aria-label={t("unreadCount", { count: unreadCount })}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">{t("recent")}</p>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-2 py-1 text-xs"
              onClick={handleMarkAll}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              {t("markAllRead")}
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notifications === undefined ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : preview.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Bell className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">{t("allRead")}</p>
              <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
            </div>
          ) : (
            <ul className="divide-y">
              {preview.map((row) => {
                const Icon = notificationIcon(row.type);
                const copy = notificationCopy(row, t);
                return (
                  <li key={row._id}>
                    <button
                      type="button"
                      onClick={() => handleOpen(row)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent",
                        !row.isRead && "bg-accent/40",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted",
                          notificationAccent(row.type),
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 space-y-0.5">
                        <span className="flex items-center gap-2">
                          <span className="line-clamp-1 text-sm font-medium">
                            {copy.title}
                          </span>
                          {!row.isRead && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-primary"
                              aria-label={t("unread")}
                            />
                          )}
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {copy.message}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(row.createdAt), {
                            addSuffix: true,
                            locale: dateLocale,
                          })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t p-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-center text-sm"
            onClick={() => setOpen(false)}
          >
            <Link href="/notifications">{t("seeAll")}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
