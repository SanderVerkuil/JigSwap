"use client";

import { TwoLevelReviewFields } from "@/components/solving/two-level-review-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { Id } from "@/gateway";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type MyReviews = FunctionReturnType<typeof gateway.solving.getMyReviews>;

interface ReviewPuzzleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Convex doc ids: the puzzle definition, and optionally the copy the solve was on.
  puzzleId: string;
  copyId?: string;
}

export function ReviewPuzzleDialog({
  open,
  onOpenChange,
  puzzleId,
  copyId,
}: ReviewPuzzleDialogProps) {
  const t = useTranslations("solving.review");

  // Fetch the caller's existing reviews while the dialog is open; the form only mounts once
  // this resolves, so its seed-once useState is safe.
  const { data } = useQuery(
    convexQuery(
      gateway.solving.getMyReviews,
      open
        ? {
            puzzleId: puzzleId as Id<"puzzles">,
            copyId: copyId as Id<"ownedPuzzles"> | undefined,
          }
        : "skip",
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {data === undefined ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <ReviewForm
            data={data}
            puzzleId={puzzleId}
            copyId={copyId}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({
  data,
  puzzleId,
  copyId,
  onOpenChange,
}: {
  data: MyReviews;
  puzzleId: string;
  copyId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("solving.review");
  const submitReviews = useMutation({
    mutationFn: useConvexMutation(gateway.solving.submitReviews),
  });

  // Snapshot the seeded values once; dirty tracking compares against this, not live query data.
  const [seed] = useState(() => ({
    puzzleRating: data.puzzle?.rating ?? 0,
    puzzleText: data.puzzle?.text ?? "",
    copyRating: data.copy?.rating ?? 0,
  }));
  const [puzzleRating, setPuzzleRating] = useState(seed.puzzleRating);
  const [puzzleText, setPuzzleText] = useState(seed.puzzleText);
  const [copyRating, setCopyRating] = useState(seed.copyRating);

  const showCopySection = copyId != null && data.copyReviewAllowed;
  const hasExisting = data.puzzle !== null || data.copy !== null;

  const handleSubmit = async () => {
    const puzzleDirty =
      puzzleRating !== seed.puzzleRating ||
      puzzleText.trim() !== seed.puzzleText;
    const copyDirty = showCopySection && copyRating !== seed.copyRating;

    if (!puzzleDirty && !copyDirty) {
      onOpenChange(false);
      return;
    }
    // The domain validates 1–5; block the call early so the user gets an inline hint instead.
    // A dirty copy level always has rating ≥ 1 by construction (stars only go 1–5).
    if (puzzleDirty && puzzleRating < 1) {
      toast.error(t("ratingRequired"));
      return;
    }
    try {
      await submitReviews.mutateAsync({
        puzzleId: puzzleId as Id<"puzzles">,
        copyId: copyId as Id<"ownedPuzzles"> | undefined,
        puzzle: puzzleDirty
          ? { rating: puzzleRating, text: puzzleText.trim() || undefined }
          : undefined,
        copy: copyDirty ? { rating: copyRating } : undefined,
      });
      toast.success(t("saved"));
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save review:", error);
      toast.error(t("saveError"));
    }
  };

  return (
    <>
      <TwoLevelReviewFields
        puzzleRating={puzzleRating}
        onPuzzleRatingChange={setPuzzleRating}
        puzzleText={puzzleText}
        onPuzzleTextChange={setPuzzleText}
        copyRating={copyRating}
        onCopyRatingChange={setCopyRating}
        showCopySection={showCopySection}
        showUpdatesExisting={hasExisting}
      />

      <DialogFooter>
        <Button onClick={handleSubmit} disabled={submitReviews.isPending}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </>
  );
}
