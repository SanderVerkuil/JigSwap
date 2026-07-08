"use client";

// Activity Log tab: the latest moderation decisions as one bordered list.
// Each stamp kind maps to an icon + tone, the sentence is i18n-interpolated
// from the kind, and the actor falls back to "System" for the automated
// pipeline's rows (photo_auto_rejected has no actorId).

import { QueueEmpty } from "@/components/admin/queue-empty";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import {
  CheckCircle,
  Eye,
  EyeOff,
  Flag,
  type LucideIcon,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";

type ActivityRow = FunctionReturnType<
  typeof gateway.admin.getModerationActivity
>[number];

const KIND_META: Record<ActivityRow["kind"], [LucideIcon, string]> = {
  definition_approved: [CheckCircle, "text-jigsaw-success"],
  definition_edited_approved: [CheckCircle, "text-jigsaw-success"],
  definition_rejected: [XCircle, "text-destructive"],
  definition_disabled: [EyeOff, "text-jigsaw-warning"],
  definition_reenabled: [Eye, "text-jigsaw-success"],
  photo_removal_confirmed: [Trash2, "text-destructive"],
  photo_auto_rejected: [Flag, "text-jigsaw-warning"],
  photo_restored: [Undo2, "text-muted-foreground"],
  role_granted: [ShieldCheck, "text-jigsaw-success"],
  role_revoked: [ShieldOff, "text-destructive"],
};

// Single source of truth for "kinds with an admin.moderation.activity.* message":
// KIND_META's Record type is exhaustive over the read model's kind union, so a
// new kind fails typecheck here and this derived list follows automatically
// (consumed by the user-detail AuditList, whose kinds arrive as plain strings).
export const MODERATION_ACTIVITY_KINDS: readonly string[] =
  Object.keys(KIND_META);

export function ActivityLog({ emptyTitle }: { emptyTitle: string }) {
  const t = useTranslations("admin.moderation");
  const format = useFormatter();
  const { data: activity, isPending } = useQuery(
    convexQuery(gateway.admin.getModerationActivity, {}),
  );

  // The undefined check narrows `activity` for TypeScript (TanStack's result union
  // still allows undefined data in the error branch); isPending is the loading signal.
  if (isPending || activity === undefined) {
    return <PageLoading message={t("activity.loading")} />;
  }
  if (activity.length === 0) {
    return <QueueEmpty title={emptyTitle} label={t("activityEmpty")} />;
  }

  return (
    <div className="rounded-xl border bg-card px-4">
      {activity.map((row, index) => {
        const [Icon, tone] = KIND_META[row.kind];
        return (
          <div
            key={`${row.targetId}-${row.at}-${index}`}
            className="flex items-center gap-3 border-b py-3 last:border-b-0"
          >
            <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden />
            <p className="min-w-0 flex-1 text-sm">
              {t.rich(`activity.${row.kind}`, {
                actor: row.actorName ?? t("activity.system"),
                target: row.targetLabel,
                strong: (chunks) => (
                  <strong className="font-semibold">{chunks}</strong>
                ),
              })}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {format.relativeTime(row.at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
