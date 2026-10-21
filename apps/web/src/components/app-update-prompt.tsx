import {
  parseVersion,
  STALE_BUILD,
  VERSION_CHECK_INTERVAL_MS,
  VERSION_URL,
  versionToPrompt,
} from "@/lib/app-version";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Offers a reload when a newer build is deployed while JigSwap is open: checks /version.json when
// the tab becomes visible again and every few minutes while it's visible, and treats a failed
// chunk load (stale chunks after a deploy) as the same signal. Never reloads by itself, so nothing
// half-typed is lost. Off on the dev server, which has no version.json. Mounted in the dashboard
// layout only; the marketing and docs pages don't need it.
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
    const onPreloadError = () => offer(STALE_BUILD);

    const interval = window.setInterval(check, VERSION_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("vite:preloadError", onPreloadError);
    };
  }, [t]);

  return null;
}
