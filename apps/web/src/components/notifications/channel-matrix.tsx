import { useUser } from "@/compat/clerk";
import {
  ADMIN_NOTIFICATION_TYPES,
  EMAIL_ELIGIBLE_TYPES,
  MANDATORY_IN_APP_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  notificationAccent,
  notificationIcon,
  type NotificationChannel,
} from "@/components/notifications/notification-meta";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
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
  onToggleCategory: (
    types: readonly NotificationType[],
    channel: NotificationChannel,
    enabled: boolean,
  ) => void;
}

// Tri-state header check for a category × channel: which types in this category are actually
// controllable on this channel (email is greyed out for non-eligible types), and whether they're
// all on, all off, or a mix.
function headerState(
  controllable: readonly NotificationType[],
  channel: NotificationChannel,
  preferences: Toggles,
): boolean | "indeterminate" {
  const onCount = controllable.filter(
    (type) => preferences[type]?.[channel] === true,
  ).length;
  if (onCount === 0) return false;
  if (onCount === controllable.length) return true;
  return "indeterminate";
}

function controllableTypes(
  types: readonly NotificationType[],
  channel: NotificationChannel,
): readonly NotificationType[] {
  if (channel === "email") {
    return types.filter((type) => EMAIL_ELIGIBLE_TYPES.has(type));
  }
  if (channel === "inApp") {
    return types.filter((type) => !MANDATORY_IN_APP_TYPES.has(type));
  }
  return types;
}

// The type×channel preference table, card-free. It's a single aligned matrix at every
// container width: one header row names each channel once, then a divide-y row per type with
// the switches in fixed-width columns that line up under the headers. Channel columns are
// narrower below the @2xl/matrix container threshold and widen once the container has room.
// The header row sticks under the shell's sticky chrome (--app-sticky-top) so a phone, where
// the table runs for several screens, never shows three unlabelled switches; that needs the
// wrapper to CLIP (overflow-clip) rather than hide its overflow, because overflow-hidden would
// make it the sticky element's scroll container. role="table" (not "grid": there is no grid
// keyboard model, each switch is its own tab stop). A switch is named by its row's title and
// its column header only; the description, and the reason a switch is locked, describe it.
const COLS =
  "grid grid-cols-[minmax(0,1fr)_repeat(3,3rem)] @2xl/matrix:grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center";

export function ChannelMatrix({
  preferences,
  channelLabel,
  onToggle,
  onToggleCategory,
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
    <div className="@container/matrix">
      <div
        role="table"
        aria-label={t("matrixLabel")}
        className="overflow-clip rounded-lg border"
      >
        <div
          role="row"
          className={cn(
            COLS,
            "bg-background/95 sticky top-[var(--app-sticky-top,0px)] z-10 border-b px-4 py-2.5 backdrop-blur-sm",
          )}
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

        {NOTIFICATION_CATEGORIES.map((category) => {
          const visible = category.types.filter((type) =>
            visibleTypes.includes(type),
          );
          if (visible.length === 0) return null;
          return (
            <Fragment key={category.key}>
              <div
                id={`category-${category.key}`}
                role="row"
                className={cn(
                  COLS,
                  "bg-muted/20 scroll-mt-[calc(var(--app-sticky-top,0px)+3rem)] border-t px-4 py-2.5",
                )}
              >
                <span role="rowheader" className="pr-4">
                  <span className="block text-sm font-semibold">
                    {t(`categories.${category.key}.title`)}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {t(`categories.${category.key}.description`)}
                  </span>
                </span>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const controllable = controllableTypes(visible, channel);
                  const disabled = controllable.length === 0;
                  const state = disabled
                    ? false
                    : headerState(controllable, channel, preferences);
                  return (
                    <div
                      role="cell"
                      key={channel}
                      className="flex justify-center"
                    >
                      <Checkbox
                        checked={state}
                        disabled={disabled}
                        onCheckedChange={() =>
                          onToggleCategory(
                            controllable,
                            channel,
                            state !== true,
                          )
                        }
                        aria-label={`${t(`categories.${category.key}.title`)} — ${channelLabel[channel]}`}
                        title={disabled ? t("emailUnavailable") : undefined}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="divide-border divide-y">
                {visible.map((type) => {
                  const Icon = notificationIcon(type);
                  const row = preferences[type] ?? {};
                  return (
                    <div
                      role="row"
                      key={type}
                      className={cn(COLS, "px-4 py-3")}
                    >
                      <span
                        role="rowheader"
                        className="flex min-w-0 items-center gap-3 pr-4"
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
                          <span
                            id={`row-${type}-title`}
                            className="text-sm font-medium"
                          >
                            {t(`types.${type}`)}
                          </span>
                          {/* Clamped only where there's room for a wide row; on a phone the
                              whole description shows (e.g. "Email comes as a short digest"). */}
                          <span
                            id={`row-${type}-desc`}
                            className="text-muted-foreground text-xs @2xl/matrix:line-clamp-2"
                          >
                            {t(`typeDesc.${type}`)}
                          </span>
                          {MANDATORY_IN_APP_TYPES.has(type) && (
                            <span
                              id={`mandatory-${type}`}
                              className="text-muted-foreground text-xs italic"
                            >
                              {t("mandatoryInApp")}
                            </span>
                          )}
                          {/* Visible, not a title tooltip: touch screens never show those. */}
                          {!EMAIL_ELIGIBLE_TYPES.has(type) && (
                            <span
                              id={`email-na-${type}`}
                              className="text-muted-foreground text-xs italic"
                            >
                              {t("emailUnavailableShort")}
                            </span>
                          )}
                        </span>
                      </span>
                      {NOTIFICATION_CHANNELS.map((channel) => {
                        const emailUnavailable =
                          channel === "email" &&
                          !EMAIL_ELIGIBLE_TYPES.has(type);
                        // Legally required notices: always on in-app.
                        const mandatory =
                          channel === "inApp" &&
                          MANDATORY_IN_APP_TYPES.has(type);
                        return (
                          <div
                            role="cell"
                            key={channel}
                            className="flex justify-center"
                          >
                            <Switch
                              checked={
                                mandatory ||
                                (!emailUnavailable && row[channel] === true)
                              }
                              disabled={emailUnavailable || mandatory}
                              onCheckedChange={(checked) =>
                                onToggle(type, channel, checked)
                              }
                              aria-labelledby={`row-${type}-title col-${channel}`}
                              aria-describedby={[
                                `row-${type}-desc`,
                                mandatory && `mandatory-${type}`,
                                emailUnavailable && `email-na-${type}`,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
