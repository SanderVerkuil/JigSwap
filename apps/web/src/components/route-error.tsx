import { DefaultErrorFallback } from "@/components/ui/error-boundary";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import * as React from "react";

/**
 * The router's default error component: what a member sees when a route's loader or component
 * throws. It renders inside Providers, so it uses the translated error card (UX-64); "Try again"
 * re-runs the failed route. The root route keeps the hook-free DefaultCatchBoundary, because it
 * renders outside IntlProvider.
 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  // The card only shows the message in development; keep it in the console for debugging.
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <DefaultErrorFallback
      error={error instanceof Error ? error : undefined}
      resetError={() => void router.invalidate()}
    />
  );
}
