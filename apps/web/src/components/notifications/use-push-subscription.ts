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
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// A subscribe that never fires: with `useSyncExternalStore` this yields the client snapshot on the
// first client render and the server snapshot during SSR — the canonical hydration-safe way to read
// browser-only values without a mount effect.
const emptySubscribe = () => () => {};

// Snapshot of the browser's notification permission. Re-read on every render (the store never
// pushes), so it refreshes whenever something else re-renders the component — e.g. the enable
// mutation settling after `Notification.requestPermission()` resolves.
const getPermissionSnapshot = (): NotificationPermission | null =>
  typeof Notification !== "undefined" ? Notification.permission : null;
const getServerPermissionSnapshot = () => null;

// The device's push subscription, shared by the notification settings and the quick start's
// push prompt (spec §2.7) so both use one implementation: permission prompt, PushManager
// subscribe with the server's VAPID key, and register/unregister with the server.
export function usePushSubscription() {
  const t = useTranslations("notifications");
  const pushConfig = useQuery(convexQuery(gateway.notifications.pushConfig, {}))
    .data as { vapidPublicKey: string | null } | undefined;
  const registerPush = useConvexMutation(gateway.notifications.registerPush);
  const unregisterPush = useConvexMutation(
    gateway.notifications.unregisterPush,
  );

  // `mounted` defers all browser-only reads (pushSupported, Notification.permission, the existing
  // subscription) to the client, so the server render and first client render agree (no hydration
  // mismatch) and we never touch `Notification`/`navigator` during SSR. false during SSR/hydration,
  // true from the first client render after.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const permission = useSyncExternalStore(
    emptySubscribe,
    getPermissionSnapshot,
    getServerPermissionSnapshot,
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

  // Seed the endpoint from the browser's actual subscription once, on the client.
  useEffect(() => {
    if (!pushSupported()) return;
    currentSubscriptionEndpoint()
      .then(setEndpoint)
      .catch(() => {});
  }, []);

  // The WHOLE enable flow — permission prompt, browser PushManager subscribe, server register —
  // runs as one mutationFn so isPending spans the entire sequence natively (busy-state rule v2).
  const enableDevice = useMutation({
    mutationFn: async () => {
      // `permission` (the useSyncExternalStore snapshot above) picks the new value up on the
      // re-render this mutation triggers when it settles — no manual setState needed.
      const perm = await Notification.requestPermission();
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

  return {
    mounted,
    supported,
    permission,
    loading,
    configured,
    enabled,
    busy,
    enable: () => enableDevice.mutate(),
    disable: () => disableDevice.mutate(),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
