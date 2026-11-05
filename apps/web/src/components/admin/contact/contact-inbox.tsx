"use client";

// Admin triage inbox for the public contact form (adminTriage.contactMessages), newest first,
// paginated with Load more. The status filter (New, the default / Handled / All) is the route's
// URL search, so a reload, Back or a shared link keeps it; New carries the waiting count from
// admin.pendingCounts. A new message is marked handled in one click, and the toast's Undo puts it
// back to new. Each message links its sender's address to the member directory (Find member).
// The listing and both transitions are admin-gated server-side in the Convex functions.
import { AdminQueryError } from "@/components/admin/admin-query-error";
import { QueueEmpty } from "@/components/admin/queue-empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { mailtoHref } from "@/lib/mailto";
import { formatQueueCount, type QueueCount } from "@/lib/queue-count";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { Check, UserSearch } from "lucide-react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";
import { CONTACT_FILTERS, type ContactFilter } from "./contact-search";

export const CONTACT_PAGE_SIZE = 25;

export function ContactInbox({
  status,
  onStatusChange,
  newCount,
}: {
  status: ContactFilter;
  onStatusChange: (status: ContactFilter) => void;
  /** How many new messages wait (admin.pendingCounts); undefined while it loads. */
  newCount?: QueueCount;
}) {
  const t = useTranslations("admin.contact");
  const label: Record<ContactFilter, string> = {
    new: t("statusNew"),
    handled: t("statusHandled"),
    all: t("statusAll"),
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t("statusFilter")}
        className="flex flex-wrap gap-2"
      >
        {CONTACT_FILTERS.map((value) => (
          <Button
            key={value}
            variant={status === value ? "default" : "outline"}
            size="sm"
            className="h-11 md:h-8"
            aria-pressed={status === value}
            onClick={() => onStatusChange(value)}
          >
            {label[value]}
            {value === "new" && newCount && (
              <span className="text-xs font-bold tabular-nums opacity-80">
                {formatQueueCount(newCount.count, newCount.capped)}
              </span>
            )}
          </Button>
        ))}
      </div>
      {/* A failed page throws (usePaginatedQuery has no error state): the boundary turns it into
          the retryable admin error, and Retry remounts the list, which subscribes again. Keyed by
          the filter so another filter starts from a clean slate. */}
      <ErrorBoundary key={status} fallback={ContactQueryError}>
        <ContactMessages status={status} />
      </ErrorBoundary>
    </div>
  );
}

function ContactQueryError({ resetError }: { resetError: () => void }) {
  return <AdminQueryError onRetry={resetError} />;
}

function ContactMessages({ status }: { status: ContactFilter }) {
  const t = useTranslations("admin.contact");
  const tAdmin = useTranslations("admin");
  const format = useFormatter();
  const {
    results: messages,
    status: pageStatus,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    gateway.adminTriage.contactMessages,
    status === "all" ? {} : { status },
    { initialNumItems: CONTACT_PAGE_SIZE },
  );
  const markHandled = useMutation({
    mutationFn: useConvexMutation(gateway.adminTriage.markContactHandled),
  });
  const reopen = useMutation({
    mutationFn: useConvexMutation(gateway.adminTriage.reopenContact),
  });
  // Scope the pending state to the message being handled so only that row's
  // button disables, exactly as the old per-id busy flag did.
  const busyId = markHandled.isPending
    ? (markHandled.variables?.id ?? null)
    : null;

  // Undo of handling: the message goes back to new (and back into the New filter).
  const undo = async (id: Id<"contactMessages">) => {
    try {
      await reopen.mutateAsync({ id });
      toast.success(t("reopenSuccess"));
    } catch {
      toast.error(t("reopenError"));
    }
  };
  // Handling is one click with no confirm, so its toast offers Undo (back to new). Under the New
  // filter the message leaves the list; Undo brings it back.
  const handle = async (id: Id<"contactMessages">) => {
    try {
      await markHandled.mutateAsync({ id });
      toast.success(t("markHandledSuccess"), {
        action: { label: t("undo"), onClick: () => void undo(id) },
      });
    } catch {
      toast.error(t("markHandledError"));
    }
  };

  if (pageStatus === "LoadingFirstPage") {
    return <PageLoading message={t("loading")} />;
  }

  if (messages.length === 0) {
    return (
      <QueueEmpty
        title={tAdmin("queueEmpty.title")}
        label={
          status === "new"
            ? t("emptyNew")
            : status === "handled"
              ? t("emptyHandled")
              : t("empty")
        }
      />
    );
  }

  return (
    <>
      <div className="rounded-xl border bg-card">
        {messages.map((message) => (
          <div
            key={message._id}
            className="flex flex-col gap-3 border-b px-4 py-3 last:border-0"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                  {message.name}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {t(`subject.${message.subject}`)}
                  </Badge>
                  {message.status === "new" ? (
                    <Badge variant="default">{t("statusNew")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("statusHandled")}</Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {/* The address is typed by an anonymous visitor: encoded, it can never add
                    cc/bcc/body fields to the reply draft. */}
                <a href={mailtoHref(message.email)} className="underline">
                  {message.email}
                </a>
                {" • "}
                {format.dateTime(new Date(message.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {message.locale && ` • ${message.locale}`}
              </p>
            </div>
            {/* Messages often carry long URLs: let them wrap anywhere instead of
                overflowing the card. */}
            <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message.message}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {message.status === "new" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handle(message._id)}
                  disabled={busyId === message._id}
                  className="flex h-11 items-center gap-1 md:h-8"
                >
                  <Check className="h-3 w-3" />
                  {t("markHandled")}
                </Button>
              )}
              {/* The member behind the address, if any: /admin/users looks an address up
                  exactly (admin.listUsers). */}
              <Button size="sm" variant="ghost" className="h-11 md:h-8" asChild>
                <Link
                  to="/admin/users"
                  search={{ q: message.email }}
                  aria-label={t("findMemberLabel", { email: message.email })}
                >
                  <UserSearch className="h-3 w-3" aria-hidden />
                  {t("findMember")}
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>

      {pageStatus === "CanLoadMore" && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-8"
            onClick={() => loadMore(CONTACT_PAGE_SIZE)}
            disabled={isLoading}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}
