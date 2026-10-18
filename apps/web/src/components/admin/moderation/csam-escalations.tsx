"use client";

// "Hash matches" tab: CSAM hash-list matches the pipeline quarantined, for the operator to report.
// Metadata only. The backend never returns an image, thumbnail or blurhash for these, and this
// pane must never try to show one. An operator note on top says what to do (report to Meldpunt
// Offlimits or the police, never open or download), a warning when hash matching is not running,
// then one row per escalation with "Mark reported" (plus an optional reference) or "Close".
import { QueueEmpty } from "@/components/admin/queue-empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import type { FunctionReturnType } from "convex/server";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";

export type CsamEscalations = FunctionReturnType<
  typeof gateway.admin.listCsamEscalations
>;
type Escalation = CsamEscalations["escalations"][number];
type EscalationStatus = Escalation["status"];

export const MELDPUNT_OFFLIMITS_URL = "https://meldpunt.offlimits.nl";

export function CsamEscalationsPanel({
  data,
  emptyTitle,
  busy,
  onMark,
}: {
  data: CsamEscalations;
  emptyTitle: string;
  busy: boolean;
  onMark: (
    id: Escalation["id"],
    status: EscalationStatus,
    note?: string,
  ) => void;
}) {
  const t = useTranslations("admin.moderation.csam");
  const { hashCheck, escalations } = data;

  return (
    <div className="space-y-4">
      <div
        role="note"
        className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
      >
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="font-medium">{t("operatorNoteTitle")}</p>
          <p className="text-muted-foreground">
            {t.rich("operatorNote", {
              link: (chunks) => (
                <a
                  href={MELDPUNT_OFFLIMITS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>

      {hashCheck.status !== "ok" && (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <p className="text-muted-foreground">
            {hashCheck.status === "missing_config"
              ? t("missingConfig", { vars: hashCheck.missingVars.join(", ") })
              : t("notConfigured")}
          </p>
        </div>
      )}

      {escalations.length === 0 ? (
        <QueueEmpty title={emptyTitle} label={t("empty")} />
      ) : (
        <ul className="rounded-xl border bg-card px-4">
          {escalations.map((escalation) => (
            <EscalationRow
              key={escalation.id}
              escalation={escalation}
              busy={busy}
              onMark={onMark}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EscalationRow({
  escalation,
  busy,
  onMark,
}: {
  escalation: Escalation;
  busy: boolean;
  onMark: (
    id: Escalation["id"],
    status: EscalationStatus,
    note?: string,
  ) => void;
}) {
  const t = useTranslations("admin.moderation.csam");
  const relativeTime = useRelativeTime();
  const noteId = useId();
  const [note, setNote] = useState(escalation.note ?? "");

  return (
    <li className="space-y-2 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={escalation.status === "open" ? "destructive" : "secondary"}
        >
          {t(`status.${escalation.status}`)}
        </Badge>
        <span className="text-sm font-semibold">
          {t(`table.${escalation.table}`)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("matched", {
            time: relativeTime(escalation.matchedAt),
            provider: escalation.provider,
          })}
        </span>
        {escalation.reportedAt !== null && (
          <span className="text-xs text-muted-foreground">
            {t("reportedAt", { time: relativeTime(escalation.reportedAt) })}
          </span>
        )}
      </div>
      {escalation.uploaderLabel && (
        <p className="text-xs text-muted-foreground">
          {t("uploader", { name: escalation.uploaderLabel })}
        </p>
      )}
      <p className="font-mono text-xs break-all text-muted-foreground">
        MD5 {escalation.md5} · SHA-1 {escalation.sha1}
      </p>
      {escalation.status === "open" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <label htmlFor={noteId} className="text-xs font-medium">
              {t("noteLabel")}
            </label>
            <Input
              id={noteId}
              value={note}
              placeholder={t("notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
            />
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onMark(escalation.id, "reported", note)}
          >
            {t("markReported")}
          </Button>
        </div>
      ) : (
        <>
          {escalation.note && <p className="text-sm">{escalation.note}</p>}
          {escalation.status === "reported" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onMark(escalation.id, "closed")}
            >
              {t("close")}
            </Button>
          )}
        </>
      )}
    </li>
  );
}
