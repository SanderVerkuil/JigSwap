import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { ChannelMatrix } from "@/components/notifications/channel-matrix";
import {
  type NotificationChannel,
  NOTIFICATION_TYPES,
} from "@/components/notifications/notification-meta";
import { PushDeviceSection } from "@/components/notifications/push-device-section";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useMutation, useQuery } from "convex/react";
import { Bell, Timer } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The toggle map the backend returns: type -> channel -> enabled. Absent resolves to off.
type Toggles = Record<string, Partial<Record<NotificationChannel, boolean>>>;

export const Route = createFileRoute("/_dashboard/notifications/preferences")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "notificationPreferences") }],
  }),
  component: NotificationPreferencesPage,
});

function NotificationPreferencesPage() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const ts = useTranslations("solving.settings");
  const tCommon = useTranslations("common");
  const { trackCompletionDuration, setTrackDuration } = useUserSettings();

  const preferences = useQuery(
    gateway.notifications.preferences,
    user?.id ? {} : "skip",
  ) as Toggles | undefined;

  const updatePreference = useMutation(gateway.notifications.updatePreference);

  if (!user || preferences === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const channelLabel: Record<NotificationChannel, string> = {
    inApp: t("channelInApp"),
    email: t("channelEmail"),
    push: t("channelPush"),
  };

  const handleToggle = async (
    type: (typeof NOTIFICATION_TYPES)[number],
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    try {
      // The mutation is the single source of truth; the reactive query reflects the new value,
      // so we don't keep local optimistic state.
      await updatePreference({ type, channel, enabled });
    } catch {
      toast.error(t("preferencesError"));
    }
  };

  // The shell chrome (PageHead) owns the "Notification preferences" title + subtitle, so there is no
  // page h1 here. Width follows the shell's content-width setting (ContentArea centres or fills), so
  // we just stretch — no local max-width. The screen is two card-free sections on the page ground.
  return (
    <div className="flex w-full flex-col gap-10 md:gap-12">
      <PushDeviceSection />

      <section>
        <SectionHead title={t("preferences")} icon={Bell} />
        <p className="text-muted-foreground mb-5 max-w-prose text-sm">
          {t("channelsNote")}
        </p>
        <ChannelMatrix
          preferences={preferences}
          channelLabel={channelLabel}
          onToggle={handleToggle}
        />
      </section>

      <section>
        <SectionHead title={ts("sectionTitle")} icon={Timer} />
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="track-duration">{ts("trackDurationLabel")}</Label>
            <p className="text-muted-foreground text-sm">
              {ts("trackDurationHint")}
            </p>
          </div>
          <Switch
            id="track-duration"
            checked={trackCompletionDuration === true}
            onCheckedChange={(checked) => void setTrackDuration(checked)}
          />
        </div>
      </section>
    </div>
  );
}
