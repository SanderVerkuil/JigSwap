import { useUser } from "@/compat/clerk";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { ChannelMatrix } from "@/components/notifications/channel-matrix";
import {
  ADMIN_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  type NotificationChannel,
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

  // Admin-only types are hidden from the jump-to list for non-admins, mirroring the
  // matrix's own filtering (channel-matrix.tsx).
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );

  if (!user || preferences === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  const visibleTypes = NOTIFICATION_TYPES.filter(
    (type) => !ADMIN_NOTIFICATION_TYPES.has(type) || isAdmin === true,
  );
  const visibleCategories = NOTIFICATION_CATEGORIES.filter((category) =>
    category.types.some((type) => visibleTypes.includes(type)),
  );

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
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
      <aside className="flex flex-col gap-6 lg:sticky lg:top-2 lg:self-start">
        <PushDeviceSection />
        <p className="text-muted-foreground max-w-prose text-sm">
          {t("channelsNote")}
        </p>
        <nav aria-label={t("jumpTo")}>
          <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            {t("jumpTo")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {visibleCategories.map((category) => (
              <li key={category.key}>
                <button
                  type="button"
                  onClick={() => {
                    // Both matrix branches are DOM-resident (CSS display split); scroll the one that's visible.
                    const el = [
                      ...document.querySelectorAll(
                        `[data-category-anchor="${category.key}"]`,
                      ),
                    ].find((n) => (n as HTMLElement).offsetParent !== null);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="text-muted-foreground hover:text-foreground text-sm hover:underline"
                >
                  {t(`categories.${category.key}.title`)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <section className="max-w-[880px]">
        <SectionHead title={t("preferences")} icon={Bell} />
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
