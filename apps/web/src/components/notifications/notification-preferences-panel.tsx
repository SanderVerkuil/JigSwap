import { useUser } from "@/compat/clerk";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { ChannelMatrix } from "@/components/notifications/channel-matrix";
import { MessagePreviewSettings } from "@/components/notifications/message-preview-settings";
import {
  ADMIN_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  type NotificationCategory,
  type NotificationChannel,
} from "@/components/notifications/notification-meta";
import { PushDeviceSection } from "@/components/notifications/push-device-section";
import { PageLoading } from "@/components/ui/loading";
import { TABS_LIST_OVERFLOW_CLASS } from "@/components/ui/tabs";
import { useScrollableTabsList } from "@/components/ui/tabs-scroll";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useRef } from "react";
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

  const restorePreferences = async (
    updates: {
      type: (typeof NOTIFICATION_TYPES)[number];
      channel: NotificationChannel;
      enabled: boolean;
    }[],
  ) => {
    try {
      await setPreferences.mutateAsync({ updates });
    } catch {
      toast.error(t("preferencesError"));
    }
  };

  // A category header flips up to 8 settings in one tap, so it offers an Undo that puts back
  // exactly the settings this tap changed (the snapshot is taken before the write).
  const handleToggleCategory = async (
    types: readonly (typeof NOTIFICATION_TYPES)[number][],
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    const previous = types
      .filter((type) => (preferences[type]?.[channel] === true) !== enabled)
      .map((type) => ({ type, channel, enabled: !enabled }));
    try {
      await setPreferences.mutateAsync({
        updates: types.map((type) => ({ type, channel, enabled })),
      });
    } catch {
      toast.error(t("preferencesError"));
      return;
    }
    if (previous.length === 0) return;
    toast.success(
      t("bulkChanged", {
        channel: channelLabel[channel],
        state: enabled ? "on" : "off",
        count: previous.length,
      }),
      {
        action: {
          label: t("undo"),
          onClick: () => void restorePreferences(previous),
        },
      },
    );
  };

  // The query container must be an ANCESTOR of the grid: a container query never styles its own
  // container, so with both on one element the two columns never applied while the aside's
  // sticky still did, and it sat over the single-column table, swallowing the switches' clicks.
  // Only Jump to sticks, just below the shell's sticky page head (--app-sticky-top): it is what's
  // useful while scrolling, and the whole aside would run off a laptop screen with it. The aside
  // stretches to the table's height (no self-start), so Jump to has that whole track to stick in.
  return (
    <div className="@container/prefs">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @4xl/prefs:grid-cols-[300px_minmax(0,1fr)] @4xl/prefs:gap-10">
        <aside className="flex min-w-0 flex-col gap-6">
          <PushDeviceSection />
          <MessagePreviewSettings />
          <p className="text-muted-foreground max-w-prose text-sm">
            {t("channelsNote")}
          </p>
          <JumpToNav categories={visibleCategories} />
        </aside>

        <section className="max-w-[880px]">
          <SectionHead title={t("preferencesByType")} icon={Bell} />
          <ChannelMatrix
            preferences={preferences}
            channelLabel={channelLabel}
            onToggle={handleToggle}
            onToggleCategory={handleToggleCategory}
          />
        </section>
      </div>
    </div>
  );
}

// Links to the table's categories: one scrolling row of chips on a single column (a list of six
// took a phone's whole first screen), a plain list that sticks beside the table on two. On touch
// they are the same 44px pills as the /notifications filter throughout; beside the table they wrap,
// which stays shorter than a stack of 44px links.
function JumpToNav({
  categories,
}: {
  categories: readonly NotificationCategory[];
}) {
  const t = useTranslations("notifications");
  const listRef = useRef<HTMLUListElement>(null);
  useScrollableTabsList(listRef);
  return (
    <nav
      aria-label={t("jumpTo")}
      className="min-w-0 @4xl/prefs:sticky @4xl/prefs:top-[calc(var(--app-sticky-top,0px)+0.5rem)]"
    >
      <p className="text-muted-foreground mb-2 text-xs font-medium">
        {t("jumpTo")}
      </p>
      <ul
        ref={listRef}
        className={`flex gap-2 ${TABS_LIST_OVERFLOW_CLASS} @4xl/prefs:flex-col @4xl/prefs:gap-1.5 @4xl/prefs:overflow-visible @4xl/prefs:[mask-image:none] @4xl/prefs:pointer-coarse:flex-row @4xl/prefs:pointer-coarse:flex-wrap @4xl/prefs:pointer-coarse:gap-2`}
      >
        {categories.map((category) => (
          <li key={category.key} className="shrink-0">
            <a
              href={`#category-${category.key}`}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-9 items-center rounded-full border px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset @4xl/prefs:min-h-0 @4xl/prefs:rounded-none @4xl/prefs:border-0 @4xl/prefs:px-0 @4xl/prefs:hover:underline pointer-coarse:bg-background pointer-coarse:text-foreground pointer-coarse:min-h-11 pointer-coarse:rounded-full pointer-coarse:border pointer-coarse:px-3.5 pointer-coarse:font-medium pointer-coarse:shadow-xs pointer-coarse:hover:no-underline"
            >
              {t(`categories.${category.key}.title`)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
