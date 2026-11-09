import {
  parseVersion,
  STALE_BUILD,
  updatePromptPosition,
  VERSION_CHECK_INTERVAL_MS,
  VERSION_URL,
  versionToPrompt,
} from "@/lib/app-version";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Offers a reload when a newer build is deployed while JigSwap is open: checks /version.json when
// the tab becomes visible again and every few minutes while it's visible, and treats a failed
// chunk load (stale chunks after a deploy) as the same signal, unless the browser is offline,
// when a failed chunk says nothing about deploys. Never reloads by itself, so nothing
// half-typed is lost. Off on the dev server, which has no version.json. Mounted in the dashboard
// layout only; the marketing and docs pages don't need it.
//
// It stays up until answered on purpose: versionToPrompt never offers the same version twice on
// this page, so a prompt that timed out would drop the update silently. On phones it shows at the
// top instead, so it never sits on the tab bar.
export function AppUpdatePrompt() {
  const t = useTranslations("appUpdate");
  const prompted = useRef<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    const offer = (latest: string | null) => {
      const version = versionToPrompt(
        __APP_VERSION__,
        prompted.current,
        latest,
      );
      if (!version) return;
      prompted.current = version;
      toast(t("available"), {
        id: "app-update",
        // The shell's phone layout (below md, as useIsMobile).
        position: updatePromptPosition(
          window.matchMedia("(max-width: 767px)").matches,
        ),
        description: t("description"),
        duration: Infinity,
        action: { label: t("reload"), onClick: () => window.location.reload() },
        cancel: { label: t("notNow"), onClick: () => {} },
      });
    };

    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => offer(parseVersion(body)))
        // Offline or mid-deploy; the next check tries again.
        .catch(() => {});
    };
    // TanStack's lazyRouteComponent (@tanstack/react-router 1.170) reloads the page the first time
    // a route's code fails to load, unless sessionStorage already holds its marker for that error.
    // Offline that reload lands on the browser's offline screen, so the markers set below hold it;
    // they go once the browser is back online, so a later failure reloads into a new build again.
    // app-update-prompt.test.tsx pins this against the installed router.
    const heldReloads = new Set<string>();
    const releaseReloads = () => {
      for (const key of heldReloads) sessionStorage.removeItem(key);
      heldReloads.clear();
    };
    const backOnline = () => {
      releaseReloads();
      check();
    };
    const onPreloadError = (event: Event) => {
      if (navigator.onLine) {
        offer(STALE_BUILD);
        return;
      }
      // Offline, a chunk that hasn't loaded yet fails for that reason, not because a newer build
      // replaced it: no prompt, and whether a newer build is out is checked once back online.
      // The error still reaches the router (never preventDefault: the import would then resolve
      // to nothing, which lazyRouteComponent never retries), so the route's error card says the
      // member is offline and loads the page once they're back.
      const { payload } = event as Event & { payload?: unknown };
      if (payload instanceof Error) {
        const key = `tanstack_router_reload:${payload.message}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          heldReloads.add(key);
        }
      }
      window.addEventListener("online", backOnline, { once: true });
    };

    const interval = window.setInterval(check, VERSION_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("online", backOnline);
      releaseReloads();
    };
  }, [t]);

  return null;
}
