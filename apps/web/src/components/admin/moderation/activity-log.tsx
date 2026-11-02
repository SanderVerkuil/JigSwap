"use client";

// Activity Log tab: every moderation decision (admin.getModerationActivity, paginated, newest
// first) as one bordered list, filterable by kind and by acting admin. Both filters are the
// route's (URL search `kind` / `actor`), so a reload, Back or a shared link restores them; the
// member page links here with `actor` set. Each stamp kind maps to an icon + tone, and the
// sentence is i18n-interpolated from the kind with the actor and the target as links: the actor
// to their member page, the target to the puzzle, member or report it names (the server resolves
// it; a photo or a hash-match escalation has no page and stays plain text). The actor falls back
// to "System" for the automated pipeline's rows (photo_auto_rejected has no actorId). A targeted
// member whose account is gone reads the localized "Deleted member" (the backend stores no name
// for them, SEC-57).
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PageLoading } from "@/components/ui/loading";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { Link } from "@tanstack/react-router";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowUpDown,
  CheckCircle,
  Eye,
  EyeOff,
  Flag,
  FolderPlus,
  ImageOff,
  MailCheck,
  MailOpen,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";

type ActivityRow = FunctionReturnType<
  typeof gateway.admin.getModerationActivity
>["page"][number];
export type ActivityKind = ActivityRow["kind"];

const PAGE_SIZE = 25;

const KIND_META: Record<ActivityKind, [LucideIcon, string]> = {
  definition_approved: [CheckCircle, "text-jigsaw-success"],
  definition_edited_approved: [CheckCircle, "text-jigsaw-success"],
  definition_rejected: [XCircle, "text-destructive"],
  definition_disabled: [EyeOff, "text-jigsaw-warning"],
  definition_reenabled: [Eye, "text-jigsaw-success"],
  definition_edited: [Pencil, "text-muted-foreground"],
  proposal_approved: [CheckCircle, "text-jigsaw-success"],
  proposal_rejected: [XCircle, "text-destructive"],
  photo_removal_confirmed: [Trash2, "text-destructive"],
  photo_auto_rejected: [Flag, "text-jigsaw-warning"],
  photo_restored: [Undo2, "text-muted-foreground"],
  photo_manually_approved: [CheckCircle, "text-jigsaw-success"],
  photo_manually_rejected: [ImageOff, "text-destructive"],
  photo_hash_check_waived: [ShieldAlert, "text-jigsaw-warning"],
  image_quarantined: [ShieldAlert, "text-destructive"],
  csam_escalation_updated: [ShieldCheck, "text-muted-foreground"],
  role_granted: [ShieldCheck, "text-jigsaw-success"],
  role_revoked: [ShieldOff, "text-destructive"],
  report_dismissed: [XCircle, "text-muted-foreground"],
  report_content_removed: [Trash2, "text-destructive"],
  report_warned: [Flag, "text-jigsaw-warning"],
  message_image_auto_rejected: [Flag, "text-jigsaw-warning"],
  message_image_restored: [Undo2, "text-muted-foreground"],
  photo_recheck_requested: [RefreshCw, "text-muted-foreground"],
  category_created: [FolderPlus, "text-jigsaw-success"],
  category_updated: [Pencil, "text-muted-foreground"],
  category_deactivated: [EyeOff, "text-jigsaw-warning"],
  category_reactivated: [Eye, "text-jigsaw-success"],
  categories_reordered: [ArrowUpDown, "text-muted-foreground"],
  contact_message_handled: [MailCheck, "text-muted-foreground"],
  contact_message_reopened: [MailOpen, "text-muted-foreground"],
};

// Single source of truth for "kinds with an admin.moderation.activity.* message" (and an
// admin.moderation.activity.kinds.* filter label): KIND_META's Record type is exhaustive over the
// read model's kind union, so a new kind fails typecheck here and this derived list follows
// automatically (consumed by the kind filter, and by the user-detail AuditList, whose kinds
// arrive as plain strings).
export const MODERATION_ACTIVITY_KINDS: readonly string[] =
  Object.keys(KIND_META);

/** A kind the log knows; anything else from the URL is ignored rather than sent to the server. */
export const isActivityKind = (value: unknown): value is ActivityKind =>
  typeof value === "string" && Object.hasOwn(KIND_META, value);

const LINK_CLASS =
  "font-semibold underline underline-offset-2 hover:no-underline";

export function ActivityLog({
  emptyTitle,
  kind,
  actorId,
  onKindChange,
  onClearActor,
}: {
  emptyTitle: string;
  /** The kind filter from the URL; an unknown kind is ignored. */
  kind?: string;
  /** The acting-admin filter from the URL (a member _id; the server normalises it). */
  actorId?: string;
  onKindChange: (kind: ActivityKind | undefined) => void;
  onClearActor: () => void;
}) {
  const activeKind = isActivityKind(kind) ? kind : undefined;
  // A failed page throws (usePaginatedQuery has no error state): this boundary turns it into the
  // retryable admin error, and Retry remounts the feed, which subscribes again. Keyed by the
  // filters so another filter starts from a clean slate.
  return (
    <ErrorBoundary
      key={`${activeKind ?? ""}:${actorId ?? ""}`}
      fallback={ActivityQueryError}
    >
      <ActivityFeed
        emptyTitle={emptyTitle}
        kind={activeKind}
        actorId={actorId}
        onKindChange={onKindChange}
        onClearActor={onClearActor}
      />
    </ErrorBoundary>
  );
}

function ActivityQueryError({ resetError }: { resetError: () => void }) {
  return <AdminQueryError onRetry={resetError} />;
}

function ActivityFeed({
  emptyTitle,
  kind,
  actorId,
  onKindChange,
  onClearActor,
}: {
  emptyTitle: string;
  kind: ActivityKind | undefined;
  actorId: string | undefined;
  onKindChange: (kind: ActivityKind | undefined) => void;
  onClearActor: () => void;
}) {
  const t = useTranslations("admin.moderation");
  const relativeTime = useRelativeTime();
  const kindSelectId = useId();
  const { results, status, loadMore } = usePaginatedQuery(
    gateway.admin.getModerationActivity,
    { ...(kind ? { kind } : {}), ...(actorId ? { actorId } : {}) },
    { initialNumItems: PAGE_SIZE },
  );
  const filtered = kind !== undefined || actorId !== undefined;
  // Every row of an actor-filtered page names the same admin.
  const actorName = actorId ? results[0]?.actorName : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={kindSelectId} className="sr-only">
          {t("activity.kindFilter")}
        </label>
        <select
          id={kindSelectId}
          value={kind ?? ""}
          onChange={(event) =>
            onKindChange(
              isActivityKind(event.target.value)
                ? event.target.value
                : undefined,
            )
          }
          className="h-11 max-w-full rounded-md border bg-card px-2 text-base focus:ring-2 focus:ring-primary focus:outline-none md:h-9 md:not-pointer-coarse:text-sm"
        >
          <option value="">{t("activity.allKinds")}</option>
          {(Object.keys(KIND_META) as ActivityKind[]).map((value) => (
            <option key={value} value={value}>
              {t(`activity.kinds.${value}`)}
            </option>
          ))}
        </select>
        {actorId && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-0.5 pl-3 text-sm">
            <span className="truncate">
              {actorName
                ? t("activity.actorFilter", { name: actorName })
                : t("activity.actorFilterUnnamed")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-full md:size-8"
              onClick={onClearActor}
              aria-label={t("activity.clearActor")}
              title={t("activity.clearActor")}
            >
              <X aria-hidden />
            </Button>
          </span>
        )}
      </div>

      {status === "LoadingFirstPage" ? (
        <PageLoading message={t("activity.loading")} />
      ) : results.length === 0 ? (
        <QueueEmpty
          title={emptyTitle}
          label={filtered ? t("activity.emptyFiltered") : t("activityEmpty")}
        />
      ) : (
        <ul className="rounded-xl border bg-card px-4">
          {results.map((row) => {
            const [Icon, tone] = KIND_META[row.kind];
            return (
              <li
                key={row.actionId}
                className="flex items-center gap-3 border-b py-3 last:border-b-0"
              >
                <Icon className={`size-4 shrink-0 ${tone}`} aria-hidden />
                <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                  {t.rich(`activity.${row.kind}`, {
                    actor: row.actorName ?? t("activity.system"),
                    target: row.targetMemberDeleted
                      ? t("activity.deletedMemberTarget")
                      : row.targetLabel,
                    actorLink: (chunks) =>
                      row.actorId ? (
                        <Link
                          to="/admin/users/$userId"
                          params={{ userId: row.actorId }}
                          className={LINK_CLASS}
                        >
                          {chunks}
                        </Link>
                      ) : (
                        <strong className="font-semibold">{chunks}</strong>
                      ),
                    targetLink: (chunks) => (
                      <TargetLink target={row.target}>{chunks}</TargetLink>
                    ),
                    // A sentence that still bolds with <strong> renders, just without a link.
                    strong: (chunks) => (
                      <strong className="font-semibold">{chunks}</strong>
                    ),
                  })}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(row.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {status === "CanLoadMore" && (
        <Button
          variant="outline"
          className="h-11 self-center md:h-9"
          onClick={() => loadMore(PAGE_SIZE)}
        >
          {t("activity.loadMore")}
        </Button>
      )}
    </div>
  );
}

// The row's target as a link to its page: the puzzle, the member (role changes) or the report
// (opened in the Reports tab's drawer). Plain bold text when it has none.
function TargetLink({
  target,
  children,
}: {
  target: ActivityRow["target"];
  children: ReactNode;
}) {
  switch (target?.kind) {
    case "puzzle":
      return (
        <Link
          to="/admin/puzzles/$puzzleId"
          params={{ puzzleId: target.puzzleId }}
          className={LINK_CLASS}
        >
          {children}
        </Link>
      );
    case "member":
      return (
        <Link
          to="/admin/users/$userId"
          params={{ userId: target.userId }}
          className={LINK_CLASS}
        >
          {children}
        </Link>
      );
    case "report":
      return (
        <Link
          to="/admin/moderation"
          search={{ tab: "reports", report: target.reportId }}
          className={LINK_CLASS}
        >
          {children}
        </Link>
      );
    default:
      return <strong className="font-semibold">{children}</strong>;
  }
}
