"use client";

import { Button } from "@/components/ui/button";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import {
  EXPORT_SECTIONS,
  type ExportPageView,
  type ExportRow,
} from "@jigswap/contracts";
// sanctioned convex/react exception: useConvex (see tanstack-query migration spec)
import { useConvex } from "convex/react";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The member's data export: read every section to its end, download it all as a dated JSON file
// and confirm with a toast. One implementation for every place that offers it (the Insights
// footer, the Privacy & safety page and the command palette), so they all download the same
// complete file.
export function useDataExport() {
  const t = useTranslations("insights.export");
  const convex = useConvex();
  // The share of sections read so far (0-100) while an export runs; null when idle.
  const [progress, setProgress] = useState<number | null>(null);

  const exportData = async () => {
    setProgress(0);
    try {
      // One-shot fetches (not live subscriptions): the export is a snapshot the user downloads,
      // so it should not re-render the page or stay subscribed after the click. Every section is
      // read page by page to its end, so the file is complete however large the history is.
      const bundle: Record<string, unknown> = {
        exportedAt: new Date().toISOString(),
      };
      for (const [index, section] of EXPORT_SECTIONS.entries()) {
        const rows: ExportRow[] = [];
        let cursor: string | null = null;
        for (;;) {
          const page: ExportPageView = await convex.query(
            gateway.insights.exportUserDataPage,
            { section, cursor },
          );
          rows.push(...page.rows);
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
        bundle[section] = rows;
        setProgress(Math.round(((index + 1) / EXPORT_SECTIONS.length) * 100));
      }

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

      toast.success(t("success"));
    } catch {
      toast.error(t("error"));
    } finally {
      setProgress(null);
    }
  };

  return { exportData, busy: progress !== null, progress };
}

// The export as a plain outline action, disabled and showing how far it is while the file is being
// prepared.
export function ExportDataButton({ className }: { className?: string }) {
  const t = useTranslations("insights.export");
  const { exportData, busy, progress } = useDataExport();
  return (
    <Button
      variant="outline"
      onClick={exportData}
      disabled={busy}
      className={cn("pointer-coarse:min-h-11", className)}
    >
      <Download aria-hidden className="h-4 w-4" />
      {progress === null ? t("button") : t("preparing", { percent: progress })}
    </Button>
  );
}

// Card-free closing row on Insights: a quiet hairline-topped footer with the snapshot
// download as a plain outline action.
export function ExportButton() {
  const t = useTranslations("insights.export");
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("description")}
        </p>
      </div>
      <ExportDataButton />
    </div>
  );
}
