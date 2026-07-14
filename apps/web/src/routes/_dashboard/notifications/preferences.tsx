import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences-panel";
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
  const tShell = useTranslations("shell");

  // /notifications has no ShellGroupKey group of its own, so the shell can't derive
  // a "Notifications › Notification preferences" crumb automatically — publish it
  // explicitly (replaces the old "Back to notifications" button).
  usePageHeader(
    () => ({
      crumbs: [
        { label: tShell("pages.notifications.title"), href: "/notifications" },
      ],
    }),
    [],
  );

  return (
    <div className="flex w-full flex-col">
      <NotificationPreferencesPanel />
    </div>
  );
}
