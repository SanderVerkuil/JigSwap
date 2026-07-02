"use client";

// The console's header line: a violet ADMIN shield pill plus a static muted
// subtitle. (The design's moderator roster was cut by spec amendment —
// adminship lives only in Clerk JWTs, so there is no roster to show.)

import { Shield } from "lucide-react";
import { useTranslations } from "use-intl";

export function AdminBanner() {
  const t = useTranslations("admin.moderation.banner");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold tracking-wide text-primary-foreground">
        <Shield className="size-3.5" aria-hidden />
        {t("pill")}
      </span>
      <span className="text-sm text-muted-foreground">{t("subtitle")}</span>
    </div>
  );
}
