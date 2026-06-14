import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { useRouter } from "@/compat/navigation";
import {
  type NotificationRow,
  type NotificationType,
  notificationAccent,
  notificationCopy,
  notificationHref,
  notificationIcon,
  notificationId,
} from "@/components/notifications/notification-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check, CheckCheck, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/notifications/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "notifications") }],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const notifications = useQuery(
    gateway.notifications.list,
    user?.id ? {} : "skip",
  ) as NotificationRow[] | undefined;

  const markRead = useMutation(gateway.notifications.markRead);
  const markAllRead = useMutation(gateway.notifications.markAllRead);

  if (!user || notifications === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkRead = async (row: NotificationRow) => {
    try {
      await markRead({ notificationId: notificationId(row) });
    } catch {
      toast.error(t("markError"));
    }
  };

  const handleOpen = (row: NotificationRow) => {
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
    <div className="container mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/notifications/preferences">
              <Settings2 className="mr-2 h-4 w-4" />
              {t("preferences")}
            </Link>
          </Button>
          <Button onClick={handleMarkAll} disabled={unreadCount === 0}>
            <CheckCheck className="mr-2 h-4 w-4" />
            {t("markAllRead")}
          </Button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium">{t("empty")}</h3>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y">
            {notifications.map((row) => {
              const Icon = notificationIcon(row.type);
              const href = notificationHref(row);
              const copy = notificationCopy(row, t);
              return (
                <li
                  key={row._id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-4 transition-colors",
                    !row.isRead && "bg-accent/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted",
                      notificationAccent(row.type),
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {href ? (
                        <button
                          type="button"
                          onClick={() => handleOpen(row)}
                          className="text-left text-sm font-medium hover:underline"
                        >
                          {copy.title}
                        </button>
                      ) : (
                        <span className="text-sm font-medium">
                          {copy.title}
                        </span>
                      )}
                      <Badge variant="secondary" className="text-[10px]">
                        {t(`types.${row.type as NotificationType}`)}
                      </Badge>
                      {!row.isRead && (
                        <span
                          className="h-2 w-2 rounded-full bg-primary"
                          aria-label={t("unread")}
                        />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {copy.message}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(row.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  {!row.isRead && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleMarkRead(row)}
                      aria-label={t("markRead")}
                      title={t("markRead")}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
