"use client";

import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
// sanctioned convex/react exception: useConvex (see tanstack-query migration spec)
import { useConvex } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export function ExportButton() {
  const t = useTranslations("insights.export");
  const convex = useConvex();
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      // One-shot fetch (not a live subscription): the export is a snapshot the user downloads,
      // so it should not re-render the page or stay subscribed after the click.
      const bundle = (await convex.query(
        gateway.insights.exportUserData,
        {},
      )) as { limitPerCollection?: number } & Record<string, unknown>;

      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `jigswap-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      // Surface the server-side row cap so a power user knows the file may be truncated.
      const counts = Object.values(bundle).filter(Array.isArray);
      const capped =
        typeof bundle.limitPerCollection === "number" &&
        counts.some((arr) => arr.length >= bundle.limitPerCollection!);

      toast.success(t("success"), {
        description: capped
          ? t("capped", { limit: bundle.limitPerCollection! })
          : undefined,
      });
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  };

  // Card-free closing row: a quiet hairline-topped footer with the snapshot
  // download as a plain outline action.
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("description")}
        </p>
      </div>
      <Button variant="outline" onClick={handleExport} disabled={busy}>
        <Download className="h-4 w-4" />
        {busy ? t("preparing") : t("button")}
      </Button>
    </div>
  );
}
