"use client";

// Shared error state for the admin console's queries. A failed Convex query
// (a role revoked mid-session, a read limit, an invalid id) leaves `data`
// undefined, which the lists used to render as an endless spinner. Render
// this on `isError` instead: role="alert" announces the failure and Retry
// re-runs the query.
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useTranslations } from "use-intl";

export function AdminQueryError({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void;
  /** The retry is in flight: the button stays disabled until it settles. */
  retrying?: boolean;
}) {
  const t = useTranslations("admin.queryError");
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center"
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <p className="font-semibold">{t("title")}</p>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 h-11 md:h-8"
        onClick={onRetry}
        disabled={retrying}
      >
        <RotateCw aria-hidden />
        {t("retry")}
      </Button>
    </div>
  );
}
