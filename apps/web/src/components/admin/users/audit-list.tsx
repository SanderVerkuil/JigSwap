"use client";

// Compact audit list for the admin user detail page, reusing the moderation
// Activity Log's label-translation approach: each row's sentence is i18n-
// interpolated from its kind under admin.moderation.activity.* (which already
// includes the role_granted/role_revoked labels). Kinds arrive typed as plain
// strings via the contracts DTO, so an unknown future kind falls back to a raw
// "kind — target" line instead of crashing on a missing message.

import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useTranslations } from "use-intl";

// The web tier derives Convex view types from the gateway (not @jigswap/contracts directly).
type AuditEntry = FunctionReturnType<
  typeof gateway.admin.getUserDetail
>["audit"]["performed"][number];

const KNOWN_KINDS: readonly string[] = [
  "definition_approved",
  "definition_edited_approved",
  "definition_rejected",
  "photo_removal_confirmed",
  "photo_auto_rejected",
  "photo_restored",
  "role_granted",
  "role_revoked",
];

export function AuditList({
  entries,
  emptyLabel,
}: {
  entries: AuditEntry[];
  emptyLabel: string;
}) {
  const t = useTranslations("admin.moderation");
  const format = useFormatter();

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card px-4">
      {entries.map((row, index) => (
        <div
          key={`${row.targetId}-${row.at}-${index}`}
          className="flex items-center gap-3 border-b py-3 last:border-b-0"
        >
          <p className="min-w-0 flex-1 text-sm">
            {KNOWN_KINDS.includes(row.kind)
              ? t.rich(`activity.${row.kind}`, {
                  actor: row.actorName ?? t("activity.system"),
                  target: row.targetLabel,
                  strong: (chunks) => (
                    <strong className="font-semibold">{chunks}</strong>
                  ),
                })
              : `${row.kind} — ${row.targetLabel}`}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {format.relativeTime(row.at)}
          </span>
        </div>
      ))}
    </div>
  );
}
