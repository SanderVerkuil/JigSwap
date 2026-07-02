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
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

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
  const reviewPuzzle = useMutation({
    mutationFn: useConvexMutation(gateway.solving.reviewPuzzle),
  });

  const [rating, setRating] = useState(initialRating ?? 0);
  const [text, setText] = useState(initialText ?? "");

  const handleSubmit = async () => {
    // The domain validates 1–5; block the call early so the user gets an inline hint instead.
    if (rating < 1) {
      toast.error(t("ratingRequired"));
      return;
    }
    try {
      await reviewPuzzle.mutateAsync({
        completionId,
        rating,
        text: text.trim() || undefined,
      });
      toast.success(t("saved"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save review:", error);
      toast.error(t("saveError"));
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
          <Button onClick={handleSubmit} disabled={reviewPuzzle.isPending}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
