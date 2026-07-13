import { useUser } from "@/compat/clerk";
import {
  ADMIN_NOTIFICATION_TYPES,
  EMAIL_ELIGIBLE_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  notificationAccent,
  notificationIcon,
  type NotificationChannel,
} from "@/components/notifications/notification-meta";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

type Toggles = Record<string, Partial<Record<NotificationChannel, boolean>>>;
type NotificationType = (typeof NOTIFICATION_TYPES)[number];

interface ChannelMatrixProps {
  preferences: Toggles;
  channelLabel: Record<NotificationChannel, string>;
  onToggle: (
    type: NotificationType,
    channel: NotificationChannel,
    enabled: boolean,
  ) => void;
}

// The 13×3 type×channel preference grid, card-free. Desktop (sm+) is an aligned matrix: one header
// row names each channel once, then a divide-y row per type with the switches in fixed-width columns
// that line up under the headers. Below sm it reflows to stacked per-type groups (each channel a
// labelled switch), since 3 aligned columns don't fit a phone. role="grid"/row/columnheader/
// rowheader/gridcell + aria-labelledby give the switches accessible names without visible per-cell
// labels on desktop.
const COLS = "grid grid-cols-[1fr_repeat(3,5.5rem)] items-center";

export function ChannelMatrix({
  preferences,
  channelLabel,
  onToggle,
}: ChannelMatrixProps) {
  const t = useTranslations("notifications");
  const { user } = useUser();

  // Admin-only types (e.g. "a proposal awaits review") are hidden from members who
  // aren't admins — they'd never receive them. While isAdmin is loading, treat as
  // false so the admin rows simply appear once it resolves rather than flashing.
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );
  const visibleTypes = NOTIFICATION_TYPES.filter(
    (type) => !ADMIN_NOTIFICATION_TYPES.has(type) || isAdmin === true,
  );

  return (
    <>
      {/* Desktop matrix */}
      <div
        role="grid"
        aria-label={t("matrixLabel")}
        className="hidden overflow-hidden rounded-lg border sm:block"
      >
        <div
          role="row"
          className={cn(COLS, "bg-muted/40 border-b px-4 py-2.5")}
        >
          <span
            role="columnheader"
            className="text-muted-foreground text-xs font-medium"
          >
            {t("notificationType")}
          </span>
          {NOTIFICATION_CHANNELS.map((channel) => (
            <span
              key={channel}
              role="columnheader"
              id={`col-${channel}`}
              className="text-muted-foreground text-center text-xs font-medium tracking-wide uppercase"
            >
              {channelLabel[channel]}
            </span>
          ))}
        </div>

        <div className="divide-border divide-y">
          {visibleTypes.map((type) => {
            const Icon = notificationIcon(type);
            const row = preferences[type] ?? {};
            return (
              <div role="row" key={type} className={cn(COLS, "px-4 py-3")}>
                <span
                  role="rowheader"
                  id={`row-${type}`}
                  className="flex items-center gap-3 pr-4"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      notificationAccent(type),
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">
                      {t(`types.${type}`)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t(`typeDesc.${type}`)}
                    </span>
                  </span>
                </span>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const emailUnavailable =
                    channel === "email" && !EMAIL_ELIGIBLE_TYPES.has(type);
                  return (
                    <div
                      role="gridcell"
                      key={channel}
                      className="flex justify-center"
                    >
                      <Switch
                        checked={!emailUnavailable && row[channel] === true}
                        disabled={emailUnavailable}
                        onCheckedChange={(checked) =>
                          onToggle(type, channel, checked)
                        }
                        aria-labelledby={`row-${type} col-${channel}`}
                        title={
                          emailUnavailable ? t("emailUnavailable") : undefined
                        }
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: stacked per-type groups with labelled switches */}
      <div className="divide-border divide-y sm:hidden">
        {visibleTypes.map((type) => {
          const Icon = notificationIcon(type);
          const row = preferences[type] ?? {};
          return (
            <div
              role="group"
              aria-labelledby={`m-${type}`}
              key={type}
              className="py-4"
            >
              <div id={`m-${type}`} className="mb-3 flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    notificationAccent(type),
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    {t(`types.${type}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`typeDesc.${type}`)}
                  </span>
                </span>
              </div>
              <div className="flex flex-col gap-3 pl-11">
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const id = `${type}-${channel}-m`;
                  const emailUnavailable =
                    channel === "email" && !EMAIL_ELIGIBLE_TYPES.has(type);
                  return (
                    <div
                      key={channel}
                      className="flex items-center justify-between"
                    >
                      <Label
                        htmlFor={id}
                        className="text-muted-foreground text-sm"
                      >
                        {channelLabel[channel]}
                      </Label>
                      <Switch
                        id={id}
                        checked={!emailUnavailable && row[channel] === true}
                        disabled={emailUnavailable}
                        onCheckedChange={(checked) =>
                          onToggle(type, channel, checked)
                        }
                        title={
                          emailUnavailable ? t("emailUnavailable") : undefined
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
