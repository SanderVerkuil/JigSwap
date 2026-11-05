"use client";

// One report for the admin decision drawer (admin.getReport): who reported
// whom and why, the evidence snapshot (the quoted thread excerpt with the
// reported message highlighted; a message already removed by a moderator
// shows as removed, never its body; a photo comment's or review's text as
// filed), the Art. 16(2) notice when present, the photo when the target still
// exists (behind the click-to-reveal RevealGuard), and the member's other
// reports (each opens in this drawer). The reporter and the reported member
// link to their admin pages. An open report ends in the decide form; a decided
// one shows its outcome and offers the next open report of the queue. Each
// decision has its own statement-of-reasons template (DECISION_TEMPLATE),
// filled in on choosing the decision while the text is still empty or a
// template; text the admin wrote is only replaced after they confirm. The
// server enforces isAdmin and validates the decision; the form only mirrors
// those rules (Remove only for message, photo, comment and review targets; a
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
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, ImageOff } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useFormatter, useTranslations } from "use-intl";
import { RevealGuard } from "./reveal-guard";

export type ReportDetailView = NonNullable<
  FunctionReturnType<typeof gateway.admin.getReport>
>;
type Decision = "dismissed" | "warned" | "content_removed";

export const MAX_STATEMENT_OF_REASONS = 2000;

/** Targets whose content an admin can remove (admin/decideReport). */
export const REMOVABLE_TARGETS: ReadonlySet<string> = new Set([
  "message",
  "photo",
  "attachment",
  "photoComment",
  "puzzleReview",
]);

const DECISIONS: readonly Decision[] = [
  "dismissed",
  "warned",
  "content_removed",
];
const TEMPLATES = ["removal", "warning", "noViolation"] as const;
type Template = (typeof TEMPLATES)[number];
// Each decision's statement-of-reasons template, so a removal text never goes out with a warning.
const DECISION_TEMPLATE: Record<Decision, Template> = {
  dismissed: "noViolation",
  warned: "warning",
  content_removed: "removal",
};

export function ReportDetail({
  report,
  nextReportId,
  onOpenReport,
}: {
  report: ReportDetailView;
  /** The queue's next open report, offered once this one is decided; null when there is none. */
  nextReportId: string | null;
  /** Opens another report in this drawer (another report against the member, or the next one). */
  onOpenReport: (reportId: string) => void;
}) {
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
  const reportedTextId = useId();

  return (
    // ph-no-capture: the drawer quotes private messages, the reporter's own
    // words and the notifier's email; none of it goes to PostHog.
    <div className="ph-no-capture flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Meta label={t("reason")}>{tReasons(report.reason)}</Meta>
        <Meta label={t("targetKind")}>{t(`kinds.${report.targetKind}`)}</Meta>
        <Meta label={t("reporter")}>
          {report.reporterId && report.reporterLabel ? (
            <MemberLink userId={report.reporterId}>
              {report.reporterLabel}
            </MemberLink>
          ) : (
            (report.reporterLabel ??
            t(report.reporterId ? "deletedMember" : "anonymisedReporter"))
          )}
        </Meta>
        <Meta label={t("reported")}>
          {report.reportedLabel ? (
            <MemberLink userId={report.reportedUserId}>
              {report.reportedLabel}
            </MemberLink>
          ) : (
            t("deletedMember")
          )}
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
            {/* Absent once the reporter is anonymised (account deleted, or retention). */}
            {report.illegalNotice.notifierName ?? t("anonymisedReporter")}
            {/* Absent when neither the notice nor the account has an email. */}
            {report.illegalNotice.notifierEmail &&
              ` · ${report.illegalNotice.notifierEmail}`}
          </p>
          {report.illegalNotice.goodFaith && (
            <p className="text-muted-foreground text-xs">{t("goodFaith")}</p>
          )}
        </section>
      )}

      {(report.targetKind === "photo" ||
        report.targetKind === "attachment" ||
        (report.targetKind === "message" && report.photoUrl)) && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs tracking-wider text-muted-foreground uppercase">
            {t("photo")}
          </h3>
          <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted">
            {report.photoUrl ? (
              // Blurred until the admin chooses to look, whatever the reported reason; keyed so
              // another report's photo starts blurred again.
              <RevealGuard key={report.reportId}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={report.photoUrl}
                  alt={report.targetSummary ?? t("photo")}
                  className="size-full object-contain"
                />
              </RevealGuard>
            ) : (
              <span className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
                {t("photoGone")}
              </span>
            )}
          </div>
        </section>
      )}

      {report.evidence.text !== undefined && (
        <section
          aria-labelledby={reportedTextId}
          className="flex flex-col gap-2"
        >
          <h3
            id={reportedTextId}
            className="text-xs tracking-wider text-muted-foreground uppercase"
          >
            {t("reportedText")}
          </h3>
          <div className="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-sm">
            <span className="text-xs font-semibold">
              {report.reportedLabel ?? t("deletedMember")}
            </span>
            <p className="mt-1 break-words whitespace-pre-wrap">
              {report.evidence.text}
            </p>
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
                        // "Nov 2, 2026": a numeric 11/2/26 reads as 11 February to a Dutch admin.
                        dateStyle: "medium",
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
          <ul className="-mx-2 flex flex-col text-sm">
            {report.otherReports.map((other) => (
              <li key={other.reportId}>
                <button
                  type="button"
                  onClick={() => onOpenReport(other.reportId)}
                  className="flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-md px-2 py-1 text-left hover:bg-accent/50 md:min-h-9"
                >
                  <span className="font-medium">{tReasons(other.reason)}</span>
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
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.status === "open" ? (
        <DecideForm report={report} />
      ) : (
        <div className="flex flex-col gap-3">
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
          {nextReportId && (
            <Button
              type="button"
              className="h-11 self-start md:h-9"
              onClick={() => onOpenReport(nextReportId)}
            >
              {t("nextOpenReport")}
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// A member named in the report, linked to their admin page (leaves the console; Back reopens
// this report from the URL).
function MemberLink({
  userId,
  children,
}: {
  userId: string;
  children: string;
}) {
  return (
    <Link
      to="/admin/users/$userId"
      params={{ userId }}
      className="inline-flex min-h-11 max-w-full items-center underline underline-offset-2 hover:no-underline md:min-h-0"
    >
      <span className="truncate">{children}</span>
    </Link>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
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
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const statementRef = useRef<HTMLTextAreaElement>(null);
  // Set when the replace confirm inserted the template, so focus returns to the text, not to the
  // Insert template button (gone once the text is the template).
  const replacedRef = useRef(false);

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
  const templateText = (template: Template) =>
    t(`templates.${template}`, templateParams);
  // Text the admin has not written themselves: empty, or exactly one of the templates.
  const untouched = (text: string) =>
    text.trim() === "" || TEMPLATES.some((tpl) => templateText(tpl) === text);
  const decisionTemplate =
    decision === null ? null : templateText(DECISION_TEMPLATE[decision]);

  // Choosing a decision fills in its template while the text is untouched; the admin's own text
  // is never overwritten (Insert template asks first).
  const chooseDecision = (value: Decision) => {
    setDecision(value);
    if (untouched(statement)) {
      setStatement(templateText(DECISION_TEMPLATE[value]));
    }
  };
  const insertTemplate = () => {
    if (decisionTemplate === null) return;
    if (untouched(statement)) setStatement(decisionTemplate);
    else setConfirmingReplace(true);
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
                onChange={() => chooseDecision(value)}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={statementId}>{t("statementLabel")}</Label>
          {decisionTemplate !== null && statement !== decisionTemplate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 md:h-8"
              onClick={insertTemplate}
            >
              {t("insertTemplate")}
            </Button>
          )}
        </div>
        <Textarea
          ref={statementRef}
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

      <AlertDialog open={confirmingReplace} onOpenChange={setConfirmingReplace}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            if (!replacedRef.current) return;
            replacedRef.current = false;
            event.preventDefault();
            statementRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("replaceTemplateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {decision &&
                t("replaceTemplateBody", {
                  decision: t(`decide.${decision}`),
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 md:h-9">
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 md:h-9"
              onClick={() => {
                if (decisionTemplate === null) return;
                replacedRef.current = true;
                setStatement(decisionTemplate);
              }}
            >
              {t("replaceTemplateConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
