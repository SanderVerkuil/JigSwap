import {
  type NotificationChannel,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  notificationAccent,
  notificationIcon,
} from "@/components/notifications/notification-meta";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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
          {NOTIFICATION_TYPES.map((type) => {
            const Icon = notificationIcon(type);
            const row = preferences[type] ?? {};
            return (
              <div role="row" key={type} className={cn(COLS, "px-4 py-3")}>
                <span
                  role="rowheader"
                  id={`row-${type}`}
                  className="flex items-center gap-3 pr-3"
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
                  <span className="text-sm font-medium">
                    {t(`types.${type}`)}
                  </span>
                </span>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <div
                    role="gridcell"
                    key={channel}
                    className="flex justify-center"
                  >
                    <Switch
                      checked={row[channel] === true}
                      onCheckedChange={(checked) =>
                        onToggle(type, channel, checked)
                      }
                      aria-labelledby={`row-${type} col-${channel}`}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: stacked per-type groups with labelled switches */}
      <div className="divide-border divide-y sm:hidden">
        {NOTIFICATION_TYPES.map((type) => {
          const Icon = notificationIcon(type);
          const row = preferences[type] ?? {};
          return (
            <div
              role="group"
              aria-labelledby={`m-${type}`}
              key={type}
              className="py-4"
            >
              <div
                id={`m-${type}`}
                className="mb-3 flex items-center gap-2.5 text-sm font-medium"
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
                {t(`types.${type}`)}
              </div>
              <div className="flex flex-col gap-3 pl-11">
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const id = `${type}-${channel}-m`;
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
                        checked={row[channel] === true}
                        onCheckedChange={(checked) =>
                          onToggle(type, channel, checked)
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
