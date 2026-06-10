"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StarRating } from "@/components/ui/star-rating";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import { useMutation } from "convex/react";
import { useTranslations } from "use-intl";
import { useState } from "react";
import { toast } from "sonner";

interface ReviewPuzzleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The Solving CompletionId the review is attached to.
  completionId: string;
  // Pre-fill when editing an existing review.
  initialRating?: number;
  initialText?: string;
}

export function ReviewPuzzleDialog({
  open,
  onOpenChange,
  completionId,
  initialRating,
  initialText,
}: ReviewPuzzleDialogProps) {
  const t = useTranslations("solving.review");
  const reviewPuzzle = useMutation(gateway.solving.reviewPuzzle);

  const [rating, setRating] = useState(initialRating ?? 0);
  const [text, setText] = useState(initialText ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    // The domain validates 1–5; block the call early so the user gets an inline hint instead.
    if (rating < 1) {
      toast.error(t("ratingRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await reviewPuzzle({
        completionId,
        rating,
        text: text.trim() || undefined,
      });
      toast.success(t("saved"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save review:", error);
      toast.error(t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("rating")}</Label>
            <StarRating
              value={rating}
              onChange={setRating}
              size="lg"
              label={t("rating")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="review-text">{t("text")}</Label>
            <Textarea
              id="review-text"
              placeholder={t("textPlaceholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
