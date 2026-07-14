import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import {
  ADMIN_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  notificationAccent,
  notificationCopy,
  notificationHref,
  notificationIcon,
  notificationId,
  type NotificationCategoryKey,
  type NotificationRow,
  type NotificationType,
} from "@/components/notifications/notification-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { useDateFnsLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import { currentSubscriptionEndpoint, pushSupported } from "@/lib/web-push";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  formatDistanceToNow,
  isToday,
  isYesterday,
  type Locale,
} from "date-fns";
import { Bell, Check, CheckCheck, Settings2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/notifications/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "notifications") }],
  }),
  component: NotificationsPage,
});

// Every NotificationType maps to exactly one category (pinned by
// notification-meta.test.ts) — used to resolve a row's category badge and to
// power the category filter pills.
const CATEGORY_BY_TYPE: Partial<
  Record<NotificationType, NotificationCategoryKey>
> = Object.fromEntries(
  NOTIFICATION_CATEGORIES.flatMap((category) =>
    category.types.map((type) => [type, category.key]),
  ),
);

type CategoryFilter = "all" | NotificationCategoryKey;

// A subscribe that never fires: yields the client snapshot after hydration and the
// server snapshot during SSR (see push-device-section.tsx for the same pattern).
const emptySubscribe = () => () => {};

// Read-only glance at whether THIS browser currently holds a push subscription —
// the same source of truth push-device-section.tsx uses, minus the enable/disable
// controls (this is a status line, not a control).
function usePushEnabledOnThisDevice(): boolean {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [endpoint, setEndpoint] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    currentSubscriptionEndpoint()
      .then(setEndpoint)
      .catch(() => setEndpoint(null));
  }, []);

  return mounted && pushSupported() && endpoint != null;
}

function NotificationsPage() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");
  const dateLocale = useDateFnsLocale();
  const router = useRouter();
  const pushEnabled = usePushEnabledOnThisDevice();

  const [category, setCategory] = useState<CategoryFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const notifications = useQuery(
    convexQuery(gateway.notifications.list, user?.id ? {} : "skip"),
  ).data as NotificationRow[] | undefined;

  // Admin-only types are hidden from non-admin members — they'd never receive
  // them — mirroring the same gating the preferences matrix applies.
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );
  const visibleTypes = NOTIFICATION_TYPES.filter(
    (type) => !ADMIN_NOTIFICATION_TYPES.has(type) || isAdmin === true,
  );
  const visibleCategories = NOTIFICATION_CATEGORIES.filter((cat) =>
    cat.types.some((type) => visibleTypes.includes(type)),
  );

  const markRead = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.markRead),
  });
  const markAllRead = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.markAllRead),
  });

  // Computed against `notifications ?? []` so this — and the header-actions
  // hook below — can run unconditionally, before the loading early return.
  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;
  const unreadMeta = t("unreadCount", { count: unreadCount });

  const handleMarkRead = async (row: NotificationRow) => {
    try {
      await markRead.mutateAsync({ notificationId: notificationId(row) });
    } catch {
      toast.error(t("markError"));
    }
  };

  const handleOpen = (row: NotificationRow) => {
    if (!row.isRead) {
      markRead
        .mutateAsync({ notificationId: notificationId(row) })
        .catch(() => {
          toast.error(t("markError"));
        });
    }
    const href = notificationHref(row);
    if (href) router.push(href);
  };

  const handleMarkAll = async () => {
    try {
      const count = await markAllRead.mutateAsync({});
      toast.success(t("markedAllRead", { count: count ?? 0 }));
    } catch {
      toast.error(t("markError"));
    }
  };

  // The page title/subtitle come from ROUTE_META's shell.pages.notifications; only
  // the meta text + actions are published here so the body carries no duplicate header.
  usePageHeaderActions(
    () => (
      <>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {unreadMeta}
        </span>
        <Button variant="outline" size="sm" asChild>
          <Link href="/notifications/preferences">
            <Settings2 className="h-4 w-4" />
            {t("preferences")}
          </Link>
        </Button>
        <Button size="sm" onClick={handleMarkAll} disabled={unreadCount === 0}>
          <CheckCheck className="h-4 w-4" />
          {t("markAllRead")}
        </Button>
      </>
    ),
    [unreadMeta],
  );

  if (!user || notifications === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const filtered = notifications.filter((row) => {
    if (unreadOnly && row.isRead) return false;
    if (
      category !== "all" &&
      CATEGORY_BY_TYPE[row.type as NotificationType] !== category
    ) {
      return false;
    }
    return true;
  });

  const groups = (
    [
      {
        key: "today",
        label: t("today"),
        rows: filtered.filter((row) => isToday(new Date(row.createdAt))),
      },
      {
        key: "yesterday",
        label: t("yesterday"),
        rows: filtered.filter((row) => isYesterday(new Date(row.createdAt))),
      },
      {
        key: "earlier",
        label: t("earlier"),
        rows: filtered.filter(
          (row) =>
            !isToday(new Date(row.createdAt)) &&
            !isYesterday(new Date(row.createdAt)),
        ),
      },
    ] as const
  ).filter((group) => group.rows.length > 0);

  const filtersActive = category !== "all" || unreadOnly;
  const clearFilters = () => {
    setCategory("all");
    setUnreadOnly(false);
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="grid gap-6 lg:gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
        <aside className="flex flex-col gap-4 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-2 xl:self-start">
          {/* Unread stat: a glanceable extra, not a control — xl only */}
          <div className="hidden xl:block">
            <p className="text-3xl font-bold tabular-nums">{unreadCount}</p>
            <p className="text-muted-foreground text-sm">{t("unreadStat")}</p>
          </div>

          {/* Category pills + unread-only toggle: always visible; horizontal
              wrap row below xl, vertical stack at xl. */}
          <div className="flex flex-wrap items-center gap-2 xl:flex-col xl:items-start xl:gap-3">
            <div className="flex flex-wrap gap-2" role="group">
              <Button
                type="button"
                size="sm"
                variant={category === "all" ? "default" : "outline"}
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
                className={cn(
                  "rounded-full",
                  category === "all" &&
                    "bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90",
                )}
              >
                {t("filterAll")}
              </Button>
              {visibleCategories.map((cat) => {
                const active = category === cat.key;
                return (
                  <Button
                    key={cat.key}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    aria-pressed={active}
                    onClick={() => setCategory(cat.key)}
                    className={cn(
                      "rounded-full",
                      active &&
                        "bg-jigsaw-primary text-white hover:bg-jigsaw-primary/90",
                    )}
                  >
                    {t(`categories.${cat.key}.title`)}
                  </Button>
                );
              })}
            </div>
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <Switch
                checked={unreadOnly}
                onCheckedChange={setUnreadOnly}
                aria-label={t("unreadOnly")}
              />
              {t("unreadOnly")}
            </label>
          </div>

          {/* Push status: a glanceable extra, not a control — xl only */}
          <div className="text-muted-foreground hidden items-center gap-1.5 text-sm xl:flex">
            <span>
              {t("pushOnDevice", {
                state: pushEnabled ? t("pushStateOn") : t("pushStateOff"),
              })}
            </span>
            <Link
              href="/notifications/preferences"
              className="hover:text-foreground underline"
            >
              {t("preferences")}
            </Link>
          </div>
        </aside>

        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          {notifications.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <Bell className="text-muted-foreground h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-medium">{t("empty")}</h3>
                <p className="text-muted-foreground text-sm">
                  {t("emptyHint")}
                </p>
              </CardContent>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <Bell className="text-muted-foreground h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-medium">{t("empty")}</h3>
                <p className="text-muted-foreground mb-4 text-sm">
                  {t("emptyHint")}
                </p>
                {filtersActive && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    {t("clearFilters")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-8">
              {groups.map((group) => (
                <section key={group.key}>
                  <SectionHead title={group.label} />
                  <ul className="divide-y">
                    {group.rows.map((row) =>
                      renderNotificationRow({
                        row,
                        t,
                        dateLocale,
                        category:
                          CATEGORY_BY_TYPE[row.type as NotificationType],
                        onOpen: handleOpen,
                        onMarkRead: handleMarkRead,
                      }),
                    )}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A plain (lowercase) render function, not a component: it's invoked directly inside
// the feed's .map(), the same shape the original inline row markup used, just
// factored out for the mobile/desktop split below.
function renderNotificationRow({
  row,
  t,
  dateLocale,
  category,
  onOpen,
  onMarkRead,
}: {
  row: NotificationRow;
  t: (key: string) => string;
  dateLocale: Locale;
  category: NotificationCategoryKey | undefined;
  onOpen: (row: NotificationRow) => void;
  onMarkRead: (row: NotificationRow) => void;
}) {
  const Icon = notificationIcon(row.type);
  const href = notificationHref(row);
  const copy = notificationCopy(row, t);
  const relativeTime = formatDistanceToNow(new Date(row.createdAt), {
    addSuffix: true,
    locale: dateLocale,
  });

  const iconChip = (
    <span
      className={cn(
        "bg-muted mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full md:mt-0",
        notificationAccent(row.type),
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  );

  const titleNode = href ? (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="text-left text-sm font-medium hover:underline"
    >
      {copy.title}
    </button>
  ) : (
    <span className="text-sm font-medium">{copy.title}</span>
  );

  const unreadDot = !row.isRead && (
    <span
      className="h-2 w-2 shrink-0 rounded-full bg-primary"
      aria-label={t("unread")}
    />
  );

  const markReadButton = !row.isRead && (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => onMarkRead(row)}
      aria-label={t("markRead")}
      title={t("markRead")}
    >
      <Check className="h-4 w-4" />
    </Button>
  );

  return (
    <li
      key={row._id}
      className={cn("transition-colors", !row.isRead && "bg-accent/40")}
    >
      {/* Below md: today's stacked row anatomy, unchanged. */}
      <div className="flex items-start gap-3 px-4 py-4 md:hidden">
        {iconChip}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {titleNode}
            <Badge variant="secondary" className="text-[10px]">
              {t(`types.${row.type as NotificationType}`)}
            </Badge>
            {unreadDot}
          </div>
          <p className="text-muted-foreground text-sm">{copy.message}</p>
          <p className="text-muted-foreground text-xs">{relativeTime}</p>
        </div>
        {markReadButton}
      </div>

      {/* md+: columnar grid. */}
      <div className="hidden items-center gap-4 px-4 py-3 md:grid md:grid-cols-[36px_minmax(0,1fr)_auto_auto_36px]">
        {iconChip}
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            {titleNode}
            {unreadDot}
          </div>
          <p className="text-muted-foreground max-w-[42rem] truncate text-sm">
            {copy.message}
          </p>
        </div>
        {category ? (
          <Badge variant="outline" className="text-[10px] whitespace-nowrap">
            {t(`categories.${category}.title`)}
          </Badge>
        ) : (
          <span />
        )}
        <span className="text-muted-foreground text-xs tabular-nums">
          {relativeTime}
        </span>
        {markReadButton}
      </div>
    </li>
  );
}
