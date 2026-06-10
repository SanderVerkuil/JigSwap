"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import type { Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { CheckCircle, Star } from "lucide-react";
import { useTranslations } from "use-intl";
import { useState } from "react";
import { toast } from "sonner";
import { StarRating } from "@/components/ui/star-rating";

// Post-exchange partner review. Keyed by the Exchange aggregateId (a string) and the OTHER
// party's user id (derived by the caller). Self-fetches the caller's existing review so a
// completed exchange already reviewed shows a non-interactive "Reviewed" chip instead of the
// action. Maps the domain's stable ConvexError codes onto friendly, localized toasts.
interface LeaveReviewDialogProps {
  exchangeId: string | undefined;
  revieweeId: Id<"users"> | undefined;
  revieweeName?: string | null;
}

type SubScores = {
  communication: number;
  packaging: number;
  condition: number;
  timeliness: number;
};

const SUB_SCORE_KEYS = [
  "communication",
  "packaging",
  "condition",
  "timeliness",
] as const;

export function LeaveReviewDialog({
  exchangeId,
  revieweeId,
  revieweeName,
}: LeaveReviewDialogProps) {
  const t = useTranslations("reputation");
  const submitReview = useMutation(gateway.reputation.submitReview);

  const existingReview = useQuery(
    gateway.reputation.myReviewForExchange,
    exchangeId ? { exchangeId } : "skip",
  );

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [scores, setScores] = useState<SubScores>({
    communication: 0,
    packaging: 0,
    condition: 0,
    timeliness: 0,
  });
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Legacy rows without an aggregateId, or a missing counterparty, can't be reviewed.
  const canReview = Boolean(exchangeId && revieweeId);

  if (existingReview) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
        <CheckCircle className="h-4 w-4" />
        {t("reviewed")}
      </span>
    );
  }

  const allFilled =
    rating >= 1 && SUB_SCORE_KEYS.every((k) => scores[k] >= 1);

  const reset = () => {
    setRating(0);
    setScores({
      communication: 0,
      packaging: 0,
      condition: 0,
      timeliness: 0,
    });
    setComment("");
  };

  const handleSubmit = async () => {
    if (!exchangeId || !revieweeId || !allFilled) return;
    setSubmitting(true);
    try {
      await submitReview({
        exchangeId,
        revieweeId,
        rating,
        comment: comment.trim() ? comment.trim() : undefined,
        scores,
      });
      toast.success(t("reviewSubmitted"));
      reset();
      setOpen(false);
    } catch (error) {
      const code =
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data
          ? (error.data as { code: string }).code
          : undefined;

      switch (code) {
        case "ExchangeNotCompleted":
          toast.error(t("errors.exchangeNotCompleted"));
          break;
        case "DuplicatePartnerReview":
          toast.error(t("errors.duplicate"));
          break;
        case "SelfReview":
          toast.error(t("errors.selfReview"));
          break;
        case "NotExchangeParticipant":
          toast.error(t("errors.notParticipant"));
          break;
        case "InvalidRating":
          toast.error(t("errors.invalidRating"));
          break;
        default:
          toast.error(t("errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={!canReview || existingReview === undefined}
          className="flex items-center gap-2"
        >
          <Star className="h-4 w-4" />
          {t("leaveReview")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reviewDialogTitle")}</DialogTitle>
          <DialogDescription>
            {revieweeName
              ? t("reviewDialogDescriptionNamed", { name: revieweeName })
              : t("reviewDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <Label>{t("overallRating")}</Label>
            <StarRating value={rating} onChange={setRating} label={t("overallRating")} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SUB_SCORE_KEYS.map((key) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-sm font-normal text-muted-foreground">
                  {t(`scores.${key}`)}
                </Label>
                <StarRating
                  size="sm"
                  value={scores[key]}
                  onChange={(v) =>
                    setScores((prev) => ({ ...prev, [key]: v }))
                  }
                  label={t(`scores.${key}`)}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review-comment">{t("commentLabel")}</Label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("commentPlaceholder")}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!allFilled || submitting}>
            {submitting ? t("submitting") : t("submitReview")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
