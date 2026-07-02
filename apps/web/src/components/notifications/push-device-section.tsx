import { SectionHead } from "@/components/dashboard-home/section-head";
import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import {
  currentSubscriptionEndpoint,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  withTimeout,
} from "@/lib/web-push";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Per-device Web Push control: a browser subscription is global to this device, separate from the
// per-type push preference toggles (which decide WHICH notifications go to push). This card-free
// section owns the "does this browser receive any push at all" decision: request permission,
// subscribe via the PushManager with the server's VAPID public key, and register/unregister the
// subscription. The UI follows the ACTUAL browser subscription; the server sync is best-effort.
export function PushDeviceSection() {
  const t = useTranslations("notifications");
  const pushConfig = useQuery(convexQuery(gateway.notifications.pushConfig, {}))
    .data as { vapidPublicKey: string | null } | undefined;
  const registerPush = useConvexMutation(gateway.notifications.registerPush);
  const unregisterPush = useConvexMutation(
    gateway.notifications.unregisterPush,
  );

  // `mounted` defers all browser-only reads (pushSupported, Notification.permission, the existing
  // subscription) to the client, so the server render and first client render agree (no hydration
  // mismatch) and we never touch `Notification`/`navigator` during SSR.
  const [mounted, setMounted] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null,
  );
  const supported = mounted && pushSupported();

  // Re-read the SOURCE OF TRUTH — does this browser actually hold a push subscription — and reflect
  // it in the UI. Called after every action so the button never diverges from reality even when the
  // server sync fails.
  const syncFromBrowser = () => {
    currentSubscriptionEndpoint()
      .then(setEndpoint)
      .catch(() => setEndpoint(null));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing mount/hydration sync; surfaced once this component became compiler-analyzable
    setMounted(true);
    if (!pushSupported()) return;
    setPermission(Notification.permission);
    currentSubscriptionEndpoint()
      .then(setEndpoint)
      .catch(() => {});
  }, []);

  // The WHOLE enable flow — permission prompt, browser PushManager subscribe, server register —
  // runs as one mutationFn so isPending spans the entire sequence natively (busy-state rule v2).
  const enableDevice = useMutation({
    mutationFn: async () => {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;
      const key = pushConfig?.vapidPublicKey;
      if (!key) return;
      // Subscribe in the browser first and reflect that immediately — the device is "on" once the
      // browser holds a subscription, regardless of whether the server sync below succeeds.
      const payload = await subscribeToPush(key);
      setEndpoint(payload.endpoint);
      // Best-effort server registration; a failure here must NOT leave the button stuck on "Enable"
      // (the browser is already subscribed and must remain turn-off-able). Timed out so a stalled
      // mutation can't hang the button either.
      console.log("[push] register subscription with server…");
      await withTimeout(registerPush(payload), 15000, "register subscription");
      console.log("[push] done");
      toast.success(t("pushEnabled"));
    },
    onError: (error) => {
      // Surface the real cause: the subscribe pipeline (permission → SW activation → PushManager)
      // has many failure points, and a silent generic toast made them undiagnosable. A hung
      // PushManager.subscribe means the browser couldn't reach its push backend (FCM/Mozilla) —
      // usually Brave's default block, a privacy extension/ad-blocker, or the network — so we show
      // actionable guidance for that specific case.
      console.error("[push] enable failed:", error);
      const msg = errorMessage(error);
      toast.error(
        msg.includes("PushManager.subscribe")
          ? t("pushServiceUnreachable")
          : `${t("pushError")}: ${msg}`,
      );
    },
    // Always reconcile with the real browser state, whatever happened above.
    onSettled: () => syncFromBrowser(),
  });

  // Same treatment for disable: browser unsubscribe + server unregister as one span.
  const disableDevice = useMutation({
    mutationFn: async () => {
      // Unsubscribe in the browser (the truth) and flip the UI before the server cleanup, so a
      // failing unregister can't leave the device stuck "on".
      const ep = await unsubscribeFromPush();
      setEndpoint(null);
      if (ep) await unregisterPush({ endpoint: ep });
      toast.success(t("pushDisabled"));
    },
    onError: (error) => {
      console.error("[push] disable failed:", error);
      toast.error(`${t("pushError")}: ${errorMessage(error)}`);
    },
    onSettled: () => syncFromBrowser(),
  });

  // Shared disable across both actions, matching the old single busy flag.
  const busy = enableDevice.isPending || disableDevice.isPending;

  const loading = pushConfig === undefined;
  const configured = pushConfig?.vapidPublicKey != null;
  const enabled = endpoint != null;

  // One bordered control row (NOT a card) holding the resolved status + action for this device.
  let row: React.ReactNode;
  if (!mounted || loading) {
    row = <Status text={t("pushDeviceDesc")} />;
  } else if (!supported) {
    row = <Status text={t("pushUnsupported")} />;
  } else if (!configured) {
    row = <Status text={t("pushUnconfigured")} />;
  } else if (permission === "denied") {
    row = <Status text={t("pushBlocked")} />;
  } else if (enabled) {
    row = (
      <>
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <BellRing className="text-jigsaw-secondary h-4 w-4" />
          {t("pushEnabledOnDevice")}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => disableDevice.mutate()}
        >
          {t("pushDisable")}
        </Button>
      </>
    );
  } else {
    row = (
      <>
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <BellOff className="h-4 w-4" />
          {t("pushDeviceDesc")}
        </span>
        <Button
          variant="brand"
          size="sm"
          disabled={busy}
          onClick={() => enableDevice.mutate()}
        >
          {t("pushEnable")}
        </Button>
      </>
    );
  }

  return (
    <section>
      <SectionHead title={t("pushDeviceTitle")} icon={Smartphone} />
      <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        {row}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t("pushDeviceSubtitle")}
      </p>
    </section>
  );
}

function Status({ text }: { text: string }) {
  return <p className="text-muted-foreground text-sm">{text}</p>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
