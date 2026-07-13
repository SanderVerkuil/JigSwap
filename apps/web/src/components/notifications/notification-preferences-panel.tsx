import { useUser } from "@/compat/clerk";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { ChannelMatrix } from "@/components/notifications/channel-matrix";
import {
  type NotificationChannel,
  NOTIFICATION_TYPES,
} from "@/components/notifications/notification-meta";
import { PushDeviceSection } from "@/components/notifications/push-device-section";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The toggle map the backend returns: type -> channel -> enabled. Absent resolves to off.
type Toggles = Record<string, Partial<Record<NotificationChannel, boolean>>>;

// Self-contained notification preferences panel — usable inside the Clerk profile
// modal (shell-user-button) or any other surface. No route/PageHead/createFileRoute
// dependencies.
export function NotificationPreferencesPanel() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");

  const preferences = useQuery(
    convexQuery(gateway.notifications.preferences, user?.id ? {} : "skip"),
  ).data as Toggles | undefined;

  const updatePreference = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.updatePreference),
  });

  const setPreferences = useMutation({
    mutationFn: useConvexMutation(gateway.notifications.setPreferences),
  });

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
      await updatePreference.mutateAsync({ type, channel, enabled });
    } catch {
      toast.error(t("preferencesError"));
    }
  };

  const handleToggleCategory = async (
    types: readonly (typeof NOTIFICATION_TYPES)[number][],
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    try {
      await setPreferences.mutateAsync({
        updates: types.map((type) => ({ type, channel, enabled })),
      });
    } catch {
      toast.error(t("preferencesError"));
    }
  };

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
          onToggleCategory={handleToggleCategory}
        />
      </section>
    </div>
  );
}
