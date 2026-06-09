"use client";

import {
  type NotificationChannel,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  notificationAccent,
  notificationIcon,
} from "@/components/notifications/notification-meta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Switch } from "@/components/ui/switch";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";

// The toggle map the backend returns: type -> channel -> enabled. Absent resolves to off.
type Toggles = Record<string, Partial<Record<NotificationChannel, boolean>>>;

export default function NotificationPreferencesPage() {
  const { user } = useUser();
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");

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

  return (
    <div className="container mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 h-auto px-2">
          <Link href="/notifications">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("backToNotifications")}
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{t("preferencesTitle")}</h1>
          <p className="text-muted-foreground">{t("preferencesSubtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("preferences")}</CardTitle>
          <CardDescription>{t("channelsNote")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {NOTIFICATION_TYPES.map((type) => {
            const Icon = notificationIcon(type);
            const row = preferences[type] ?? {};
            return (
              <div
                key={type}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted",
                      notificationAccent(type),
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium">
                    {t(`types.${type}`)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 sm:gap-6">
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const id = `${type}-${channel}`;
                    const comingSoon = channel !== "inApp";
                    return (
                      <div
                        key={channel}
                        className="flex items-center gap-2"
                      >
                        <Switch
                          id={id}
                          checked={row[channel] === true}
                          onCheckedChange={(checked) =>
                            handleToggle(type, channel, checked)
                          }
                        />
                        <div className="flex flex-col">
                          <Label
                            htmlFor={id}
                            className="cursor-pointer text-xs"
                          >
                            {channelLabel[channel]}
                          </Label>
                          {comingSoon && (
                            <Badge
                              variant="outline"
                              className="mt-0.5 px-1 py-0 text-[9px] font-normal text-muted-foreground"
                            >
                              {t("channelComingSoon")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
