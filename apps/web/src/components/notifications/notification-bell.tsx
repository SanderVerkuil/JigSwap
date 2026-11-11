"use client";

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { NotificationView } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { NotificationItem } from "./notification-item";
import { formatUnreadBadge } from "./unread-count";

// How many recent rows the dropdown shows; the rest live on the full page.
const PREVIEW_COUNT = 6;

export function NotificationBell({ className }: { className?: string }) {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  // Both reactive: the badge and the preview update live as events land. Gated on a signed-in
  // member so we never fire the query unauthenticated (and to mirror the existing "skip" pattern).
  const signedIn = Boolean(user?.id);
  const { data: unread } = useQuery(
    convexQuery(gateway.notifications.unreadCount, signedIn ? {} : "skip"),
  );
  const notifications = useQuery(
    convexQuery(
      gateway.notifications.listViews,
      signedIn && open
        ? { paginationOpts: { numItems: PREVIEW_COUNT, cursor: null } }
        : "skip",
    ),
  ).data?.page;

  const markRead = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.markRead),
  });
  const markAllRead = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.markAllRead),
  });

  const unreadCount = unread ?? 0;
  // One display string for the badge and the trigger's name, so the visible count is always
  // part of what screen readers announce (WCAG 2.5.3 Label in Name).
  const unreadLabel = formatUnreadBadge(unreadCount);
  const preview = notifications ?? [];

  // The row link navigates; opening closes the popover and marks the row read without blocking.
  const handleOpen = (view: NotificationView) => {
    if (view.href) setOpen(false);
    if (!view.isRead) {
      markRead.mutateAsync({ notificationId: view.id }).catch(() => {
        toast.error(t("markError"));
      });
    }
  };

  const handleMarkAll = async () => {
    try {
      const count = await markAllRead.mutateAsync({});
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
          className={cn("relative", className)}
          aria-label={
            unreadCount > 0
              ? t("bellWithCount", { count: unreadLabel })
              : t("bell")
          }
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              aria-hidden
              className="bg-jigsaw-primary-accent absolute -top-1 -right-1 h-5 min-w-5 justify-center rounded-full border-transparent px-1 text-[10px] leading-none text-white tabular-nums"
            >
              {unreadLabel}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        aria-labelledby={titleId}
        // Focus the dialog itself rather than its first tabbable: the rows load only after
        // opening, so that would be a footer action. Tab then walks the rows first.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        className="w-80 p-0 sm:w-96"
      >
        <div className="border-b px-4 py-3">
          <p id={titleId} className="text-sm font-semibold">
            {t("recent")}
          </p>
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
              {preview.map((view) => (
                <NotificationItem
                  key={view.id}
                  view={view}
                  surface="popover"
                  onOpen={handleOpen}
                />
              ))}
            </ul>
          )}
        </div>

        {/* The bulk action comes after the rows, so a keyboard user can't mark everything read
            by pressing Enter right after opening. Both actions share the row, or stack when the
            labels are too long for one line (Dutch). */}
        <div className="flex flex-wrap items-center gap-1 border-t p-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="flex-1 justify-center text-sm"
            onClick={() => setOpen(false)}
          >
            <Link href="/notifications">{t("seeAll")}</Link>
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-center text-xs"
              onClick={handleMarkAll}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              {t("markAllRead")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
