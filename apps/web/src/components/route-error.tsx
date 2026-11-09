import { DefaultErrorFallback } from "@/components/ui/error-boundary";
import { useOnline } from "@/lib/use-connection-state";
import {
  useRouteContext,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import * as React from "react";
import { useTranslations } from "use-intl";

/**
 * The router's default error component: what a member sees when a route's loader or component
 * throws. It renders inside Providers, so it uses the translated error card (UX-64); "Try again"
 * re-runs the failed route, and a link leads back to the dashboard (home when signed out). Offline,
 * the page most likely failed to load for that reason: the card says so and tries again by itself
 * once the browser is back online. The root route keeps the hook-free DefaultCatchBoundary, because
 * it renders outside IntlProvider.
 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const t = useTranslations("common.errorBoundary");
  const tNotFound = useTranslations("notFound");
  // The router's default, so it also shows on public pages (catalog, docs): only members have a
  // dashboard to go back to.
  const { userId } = useRouteContext({ from: "__root__" });
  const online = useOnline();
  // The card only shows the message in development; keep it in the console for debugging.
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  // Retry when the card goes from offline to online. Keyed on the flip itself, not on the
  // browser's 'online' event: React re-renders between that event's listeners, so a listener
  // added only while offline is removed before the event reaches it.
  const wasOffline = React.useRef(false);
  React.useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    void router.invalidate();
  }, [online, router]);
  return (
    <DefaultErrorFallback
      error={error instanceof Error ? error : undefined}
      resetError={() => void router.invalidate()}
      title={online ? undefined : t("offlineTitle")}
      description={online ? undefined : t("offlineDescription")}
      homeLink={
        userId
          ? { href: "/dashboard", label: tNotFound("backToDashboard") }
          : { href: "/", label: tNotFound("backToHome") }
      }
    />
  );
}
