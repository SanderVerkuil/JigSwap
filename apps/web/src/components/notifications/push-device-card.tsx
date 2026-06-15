import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { gateway } from "@/gateway";
import {
  currentSubscriptionEndpoint,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/web-push";
import { useMutation, useQuery } from "convex/react";
import { BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Per-device Web Push control: a browser subscription is global to this device, separate from the
// per-type push preference toggles (which decide WHICH notifications go to push). This card owns the
// "does this browser receive any push at all" decision: request permission, subscribe via the
// PushManager with the server's VAPID public key, and register/unregister the subscription.
export function PushDeviceCard() {
  const t = useTranslations("notifications");
  const pushConfig = useQuery(gateway.notifications.pushConfig, {}) as
    | { vapidPublicKey: string | null }
    | undefined;
  const registerPush = useMutation(gateway.notifications.registerPush);
  const unregisterPush = useMutation(gateway.notifications.unregisterPush);

  // `mounted` defers all browser-only reads (pushSupported, Notification.permission, the existing
  // subscription) to the client, so the server render and first client render agree (no hydration
  // mismatch) and we never touch `Notification`/`navigator` during SSR.
  const [mounted, setMounted] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const supported = mounted && pushSupported();

  useEffect(() => {
    setMounted(true);
    if (!pushSupported()) return;
    setPermission(Notification.permission);
    currentSubscriptionEndpoint()
      .then(setEndpoint)
      .catch(() => {});
  }, []);

  if (!mounted) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;
      const key = pushConfig?.vapidPublicKey;
      if (!key) return;
      const payload = await subscribeToPush(key);
      await registerPush(payload);
      setEndpoint(payload.endpoint);
      toast.success(t("pushEnabled"));
    } catch {
      toast.error(t("pushError"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const ep = await unsubscribeFromPush();
      if (ep) await unregisterPush({ endpoint: ep });
      setEndpoint(null);
      toast.success(t("pushDisabled"));
    } catch {
      toast.error(t("pushError"));
    } finally {
      setBusy(false);
    }
  };

  // Resolve the single status message + action for the current device state.
  const configured = pushConfig?.vapidPublicKey != null;
  const enabled = endpoint != null;

  let body: React.ReactNode;
  if (!supported) {
    body = <Status text={t("pushUnsupported")} />;
  } else if (!configured) {
    body = <Status text={t("pushUnconfigured")} />;
  } else if (permission === "denied") {
    body = <Status text={t("pushBlocked")} />;
  } else if (enabled) {
    body = (
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <BellRing className="text-jigsaw-secondary h-4 w-4" />
          {t("pushEnabledOnDevice")}
        </span>
        <Button variant="outline" size="sm" disabled={busy} onClick={disable}>
          {t("pushDisable")}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <BellOff className="h-4 w-4" />
          {t("pushDeviceDesc")}
        </span>
        <Button variant="brand" size="sm" disabled={busy} onClick={enable}>
          {t("pushEnable")}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pushDeviceTitle")}</CardTitle>
        <CardDescription>{t("pushDeviceSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function Status({ text }: { text: string }) {
  return <p className="text-muted-foreground text-sm">{text}</p>;
}
