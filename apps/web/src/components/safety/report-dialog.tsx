"use client";

// The report (DSA notice) dialog, spec 2.5: a Dialog on desktop, a bottom
// Sheet on mobile. Controlled, so any trigger can open it (a message's "More"
// menu, a member menu, the photo lightbox). Radix traps focus inside; because
// a menu item that opened it is gone by the time it closes, `returnFocusRef`
// names the element focus goes back to.
//
// The form: a reason radio group (required), optional details (≤ 1000
// characters), "Also block {name}" (pre-checked for harassment and sexual
// content; only when the member's id is known) and, for illegal content, the
// required good-faith statement. The notifier's name and email come from the
// account server-side (reports/fileReport). After filing, an optional block
// runs, then a confirmation screen replaces the form. The server is the real
// gate; the UI only maps its refusal codes to copy.
import { conversationErrorCode } from "@/components/messaging/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { gateway, type Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { useConvexMutation } from "@convex-dev/react-query";
import { CheckCircle2 } from "lucide-react";
import { useId, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export const REPORT_REASONS = [
  "spam_scam",
  "harassment_hate",
  "sexual",
  "fake_trade",
  "illegal",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Reasons where "Also block" starts checked. */
const BLOCK_BY_DEFAULT: ReadonlySet<ReportReason> = new Set([
  "harassment_hate",
  "sexual",
]);

export const MAX_REPORT_DETAILS = 1000;

/** What is reported. A message carries its text so the dialog can quote it. */
export type ReportTarget =
  | { kind: "message"; id: string; snippet: string }
  | { kind: "user" | "photo" | "exchange"; id: string };

// Refusal codes from reports/fileReport → safety.report.errors.* keys.
const ERROR_KEYS = {
  RateLimited: "rateLimited",
  NotFound: "notFound",
  DetailsTooLong: "detailsTooLong",
  IllegalNoticeRequired: "illegalNoticeRequired",
  IllegalNoticeIncomplete: "illegalNoticeIncomplete",
} as const;

export function ReportDialog({
  target,
  name,
  memberId,
  open,
  onOpenChange,
  onBlocked,
  returnFocusRef,
}: {
  target: ReportTarget;
  /** The reported member's resolved display name. */
  name: string;
  /** The reported member's id; offers "Also block" only when known. */
  memberId?: Id<"users">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after "Also block" succeeded. */
  onBlocked?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const isMobile = useIsMobile();

  const onCloseAutoFocus = (event: Event) => {
    // A trigger that unmounted meanwhile can't take focus: leave it to Radix.
    const focusTarget = returnFocusRef?.current;
    if (!focusTarget?.isConnected) return;
    event.preventDefault();
    focusTarget.focus();
  };

  // Radix unmounts the content when closed, so the form's state resets on
  // every open.
  const body = (
    <ReportForm
      target={target}
      name={name}
      memberId={memberId}
      onClose={() => onOpenChange(false)}
      onBlocked={onBlocked}
      Title={isMobile ? SheetTitle : DialogTitle}
      Description={isMobile ? SheetDescription : DialogDescription}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-xl p-4 pt-6"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

type TitleComponent = typeof DialogTitle | typeof SheetTitle;
type DescriptionComponent = typeof DialogDescription | typeof SheetDescription;

function ReportForm({
  target,
  name,
  memberId,
  onClose,
  onBlocked,
  Title,
  Description,
}: {
  target: ReportTarget;
  name: string;
  memberId?: Id<"users">;
  onClose: () => void;
  onBlocked?: () => void;
  Title: TitleComponent;
  Description: DescriptionComponent;
}) {
  const t = useTranslations("safety.report");
  const tSafety = useTranslations("safety");
  const tCommon = useTranslations("common");
  const ids = useId();
  const fileReport = useConvexMutation(gateway.reports.fileReport);
  const blockMember = useConvexMutation(gateway.social.blockMember);

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [goodFaith, setGoodFaith] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ blocked: boolean } | null>(null);

  const chooseReason = (next: ReportReason) => {
    setReason(next);
    setAlsoBlock(BLOCK_BY_DEFAULT.has(next));
    setError(null);
  };

  const canSubmit =
    reason !== null && (reason !== "illegal" || goodFaith) && !submitting;

  const submit = async () => {
    if (!canSubmit || reason === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = details.trim();
      await fileReport({
        targetKind: target.kind,
        targetId: target.id,
        reason,
        ...(trimmed ? { details: trimmed } : {}),
        ...(reason === "illegal" ? { illegalNotice: { goodFaith: true } } : {}),
      });
    } catch (err) {
      const code = conversationErrorCode(err);
      const key =
        code && code in ERROR_KEYS
          ? ERROR_KEYS[code as keyof typeof ERROR_KEYS]
          : "generic";
      setError(t(`errors.${key}`));
      setSubmitting(false);
      return;
    }
    // The report is filed; a failed block doesn't undo it.
    let blocked = false;
    if (alsoBlock && memberId) {
      try {
        await blockMember({ memberId });
        blocked = true;
        onBlocked?.();
      } catch {
        toast.error(tSafety("blockError", { name }));
      }
    }
    setSubmitting(false);
    setDone({ blocked });
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <CheckCircle2 className="text-jigsaw-success size-8" aria-hidden />
        <Title className="text-lg font-semibold">{t("doneTitle")}</Title>
        <Description className="text-muted-foreground text-sm">
          {t("doneBody", { name })}
        </Description>
        {done.blocked && (
          <p className="text-muted-foreground text-sm">
            {tSafety("blockedBanner", { name })}
          </p>
        )}
        <Button className="mt-2 h-11 w-full md:h-9 md:w-auto" onClick={onClose}>
          {t("done")}
        </Button>
      </div>
    );
  }

  const detailsId = `${ids}-details`;
  const counterId = `${ids}-counter`;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2 pr-6">
        <Title className="text-lg leading-none font-semibold">
          {t("title", { name })}
        </Title>
        <Description className="text-muted-foreground text-sm">
          {t("description")}
        </Description>
      </div>

      {/* The reported context, read-only. */}
      {target.kind === "message" ? (
        <blockquote className="bg-muted text-muted-foreground line-clamp-4 rounded-md border-l-4 px-3 py-2 text-sm break-words whitespace-pre-wrap">
          {target.snippet}
        </blockquote>
      ) : (
        <p className="bg-muted rounded-md px-3 py-2 text-sm">
          {target.kind === "photo"
            ? t("reportingPhoto", { name })
            : t("reportingMember", { name })}
        </p>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">
          {t("reasonLegend")}
        </legend>
        {REPORT_REASONS.map((value) => (
          <label
            key={value}
            className="hover:bg-accent/50 flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm md:min-h-9"
          >
            <input
              type="radio"
              name={`${ids}-reason`}
              value={value}
              checked={reason === value}
              onChange={() => chooseReason(value)}
              className="accent-primary size-4 shrink-0"
            />
            {t(`reasons.${value}`)}
          </label>
        ))}
      </fieldset>

      {reason === "illegal" && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id={`${ids}-good-faith`}
              checked={goodFaith}
              onCheckedChange={(checked) => setGoodFaith(checked === true)}
              aria-required
              className="mt-0.5"
            />
            <Label htmlFor={`${ids}-good-faith`} className="leading-snug">
              {t("goodFaith")}
            </Label>
          </div>
          <p className="text-muted-foreground text-xs">
            {t("notifierIncluded")}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={detailsId}>{t("detailsLabel")}</Label>
        <Textarea
          id={detailsId}
          value={details}
          maxLength={MAX_REPORT_DETAILS}
          onChange={(event) => setDetails(event.target.value)}
          aria-describedby={counterId}
          rows={3}
        />
        <p id={counterId} className="text-muted-foreground self-end text-xs">
          {t("detailsCounter", {
            count: details.length,
            max: MAX_REPORT_DETAILS,
          })}
        </p>
      </div>

      {memberId && (
        <CheckRow
          id={`${ids}-block`}
          checked={alsoBlock}
          onChange={setAlsoBlock}
        >
          {t("alsoBlock", { name })}
        </CheckRow>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11 md:h-9"
          onClick={onClose}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" className="h-11 md:h-9" disabled={!canSubmit}>
          {submitting ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 md:min-h-9">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id}>{children}</Label>
    </div>
  );
}
