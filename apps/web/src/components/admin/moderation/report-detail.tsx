"use client";

// One report for the admin decision drawer (admin.getReport): who reported
// whom and why, the evidence snapshot (the quoted thread excerpt with the
// reported message highlighted; a message already removed by a moderator
// shows as removed, never its body), the Art. 16(2) notice when present, the
// photo when the target still exists, and the member's other reports. An
// open report ends in the decide form; a decided one shows its outcome.
// The server enforces isAdmin and validates the decision; the form only
// mirrors those rules (Remove only for message and photo targets; a
// statement of reasons of 1–2000 characters).
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { ImageOff } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";

export type ReportDetailView = NonNullable<
  FunctionReturnType<typeof gateway.admin.getReport>
>;
type Decision = "dismissed" | "warned" | "content_removed";

export const MAX_STATEMENT_OF_REASONS = 2000;

/** Targets whose content an admin can remove (admin/decideReport). */
export const REMOVABLE_TARGETS: ReadonlySet<string> = new Set([
  "message",
  "photo",
]);

const DECISIONS: readonly Decision[] = [
  "dismissed",
  "warned",
  "content_removed",
];
const TEMPLATES = ["removal", "warning", "noViolation"] as const;

export function ReportDetail({ report }: { report: ReportDetailView }) {
  const t = useTranslations("admin.moderation.reports");
  const tReasons = useTranslations("safety.report.reasons");
  const tSafety = useTranslations("safety");
  const format = useFormatter();
  const relativeTime = useRelativeTime();

  const authorLabel = (authorId?: string) =>
    authorId === undefined
      ? t("system")
      : authorId === report.reporterId
        ? (report.reporterLabel ?? t("deletedMember"))
        : authorId === report.reportedUserId
          ? (report.reportedLabel ?? t("deletedMember"))
          : t("otherParticipant");

  const messages = report.evidence.messages ?? [];

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Meta label={t("reason")}>{tReasons(report.reason)}</Meta>
        <Meta label={t("targetKind")}>{t(`kinds.${report.targetKind}`)}</Meta>
        <Meta label={t("reporter")}>
          {report.reporterLabel ?? t("deletedMember")}
        </Meta>
        <Meta label={t("reported")}>
          {report.reportedLabel ?? t("deletedMember")}
        </Meta>
        <Meta label={t("filed")}>{relativeTime(report.createdAt)}</Meta>
        <Meta label={t("status")}>{t(`statuses.${report.status}`)}</Meta>
      </dl>

      {report.details && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs tracking-wider text-muted-foreground uppercase">
            {t("details")}
          </h3>
          <p className="text-sm break-words whitespace-pre-wrap">
            {report.details}
          </p>
        </section>
      )}

      {report.illegalNotice && (
        <section className="flex flex-col gap-1 rounded-md border p-3 text-sm">
          <h3 className="font-semibold">{t("illegalNotice")}</h3>
          <p>
            {report.illegalNotice.notifierName}
            {/* Absent when neither the notice nor the account has an email. */}
            {report.illegalNotice.notifierEmail &&
              ` · ${report.illegalNotice.notifierEmail}`}
          </p>
          {report.illegalNotice.goodFaith && (
            <p className="text-muted-foreground text-xs">{t("goodFaith")}</p>
          )}
        </section>
      )}

      {report.targetKind === "photo" && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs tracking-wider text-muted-foreground uppercase">
            {t("photo")}
          </h3>
          <div className="aspect-[16/10] overflow-hidden rounded-xl bg-muted">
            {report.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.photoUrl}
                alt={report.targetSummary ?? t("photo")}
                className="size-full object-contain"
              />
            ) : (
              <span className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
                {t("photoGone")}
              </span>
            )}
          </div>
        </section>
      )}

      {messages.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs tracking-wider text-muted-foreground uppercase">
            {t("evidence")}
          </h3>
          <ol className="flex flex-col gap-2">
            {messages.map((message) => {
              const target = message.messageId === report.targetId;
              return (
                <li
                  key={message.messageId}
                  aria-current={target ? "true" : undefined}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    target
                      ? "border-destructive bg-destructive/5"
                      : "border-transparent bg-muted/50",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {authorLabel(message.authorId)}
                    </span>
                    <time dateTime={new Date(message.sentAt).toISOString()}>
                      {format.dateTime(new Date(message.sentAt), {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </time>
                    {target && (
                      <Badge variant="destructive">
                        {t("reportedMessage")}
                      </Badge>
                    )}
                  </div>
                  {message.removed ? (
                    <p className="text-muted-foreground mt-1 italic">
                      {tSafety("messageRemoved")}
                    </p>
                  ) : (
                    <p className="mt-1 break-words whitespace-pre-wrap">
                      {message.body}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs tracking-wider text-muted-foreground uppercase">
          {t("otherReports", { count: report.otherReportCount })}
        </h3>
        {report.otherReports.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {report.otherReports.map((other) => (
              <li key={other.reportId} className="flex flex-wrap gap-x-2">
                <span>{tReasons(other.reason)}</span>
                <span aria-hidden>·</span>
                <span>{t(`kinds.${other.targetKind}`)}</span>
                <span aria-hidden>·</span>
                <span className="text-muted-foreground">
                  {t(`statuses.${other.status}`)}
                </span>
                <span aria-hidden>·</span>
                <span className="text-muted-foreground">
                  {relativeTime(other.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.status === "open" ? (
        <DecideForm report={report} />
      ) : (
        <section className="flex flex-col gap-1 rounded-md border p-3 text-sm">
          <h3 className="font-semibold">
            {report.decision
              ? t(`decisions.${report.decision}`)
              : t(`statuses.${report.status}`)}
          </h3>
          {report.statementOfReasons && (
            <p className="break-words whitespace-pre-wrap">
              {report.statementOfReasons}
            </p>
          )}
          {report.decidedByLabel && (
            <p className="text-muted-foreground text-xs">
              {t("decidedBy", { name: report.decidedByLabel })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-semibold">{children}</dd>
    </div>
  );
}

function DecideForm({ report }: { report: ReportDetailView }) {
  const t = useTranslations("admin.moderation.reports");
  const ids = useId();
  const decide = useConvexMutation(gateway.admin.decideReport);
  const removable = REMOVABLE_TARGETS.has(report.targetKind);

  const [decision, setDecision] = useState<Decision | null>(null);
  const [statement, setStatement] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmed = statement.trim();
  const canSubmit =
    decision !== null &&
    trimmed.length > 0 &&
    trimmed.length <= MAX_STATEMENT_OF_REASONS &&
    !busy;

  const templateParams = {
    content: t(`templateContent.${report.targetKind}`),
    ground: t(`grounds.${report.reason}`),
  };

  const run = async () => {
    if (!canSubmit || decision === null) return;
    setBusy(true);
    try {
      await decide({
        reportId: report.reportId,
        decision,
        statementOfReasons: trimmed,
      });
      toast.success(t("decided"));
    } catch {
      toast.error(t("decideError"));
    } finally {
      setBusy(false);
    }
  };

  const statementId = `${ids}-statement`;
  const counterId = `${ids}-counter`;

  return (
    <form
      className="flex flex-col gap-4 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        if (decision === "content_removed") setConfirmingRemove(true);
        else void run();
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-semibold">
          {t("decisionLegend")}
        </legend>
        {DECISIONS.map((value) => {
          const disabled = value === "content_removed" && !removable;
          return (
            <label
              key={value}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md px-2 text-sm md:min-h-9",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-accent/50",
              )}
            >
              <input
                type="radio"
                name={`${ids}-decision`}
                value={value}
                checked={decision === value}
                disabled={disabled}
                onChange={() => setDecision(value)}
                className="accent-primary size-4 shrink-0"
              />
              {t(`decide.${value}`)}
            </label>
          );
        })}
        {!removable && (
          <p className="text-muted-foreground px-2 text-xs">
            {t("removeUnavailable")}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={statementId}>{t("statementLabel")}</Label>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((template) => (
            <Button
              key={template}
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={() =>
                setStatement(t(`templates.${template}`, templateParams))
              }
            >
              {t(`templateNames.${template}`)}
            </Button>
          ))}
        </div>
        <Textarea
          id={statementId}
          value={statement}
          required
          maxLength={MAX_STATEMENT_OF_REASONS}
          onChange={(event) => setStatement(event.target.value)}
          aria-describedby={counterId}
          rows={5}
        />
        <p id={counterId} className="text-muted-foreground text-xs">
          {t("statementHint", {
            count: statement.length,
            max: MAX_STATEMENT_OF_REASONS,
          })}
        </p>
      </div>

      <Button
        type="submit"
        variant={decision === "content_removed" ? "destructive" : "default"}
        className="h-11 self-start md:h-9"
        disabled={!canSubmit}
      >
        {decision ? t(`submit.${decision}`) : t("submit.none")}
      </Button>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({
                variant: "destructive",
                className: "h-11 md:h-9",
              })}
              onClick={() => void run()}
            >
              {t("submit.content_removed")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
