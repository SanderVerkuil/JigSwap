import { Link } from "@/compat/link";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences-panel";
import { Button } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/notifications/preferences")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "notificationPreferences") }],
  }),
  component: NotificationPreferencesPage,
});

function NotificationPreferencesPage() {
  const t = useTranslations("notifications");

  return (
    <div className="container mx-auto max-w-3xl space-y-6">
      <Button variant="outline" asChild>
        <Link href="/notifications">{t("backToNotifications")}</Link>
      </Button>
      <div>
        <h1 className="text-3xl font-bold">{t("preferencesTitle")}</h1>
        <p className="text-muted-foreground">{t("preferencesSubtitle")}</p>
      </div>
      <NotificationPreferencesPanel />
    </div>
  );
}
