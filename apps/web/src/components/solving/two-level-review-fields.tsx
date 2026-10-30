"use client";

import { Label } from "@/components/ui/label";
import { StarRating } from "@/components/ui/star-rating";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_TEXT_MAX_LENGTH } from "@/lib/text-limits";
import { useTranslations } from "use-intl";

interface TwoLevelReviewFieldsProps {
  puzzleRating: number;
  onPuzzleRatingChange: (rating: number) => void;
  puzzleText: string;
  onPuzzleTextChange: (text: string) => void;
  copyRating: number;
  onCopyRatingChange: (rating: number) => void;
  // Puzzle question is only rendered when the viewer may review the puzzle (getMyReviews'
  // puzzleReviewAllowed: an approved definition, or their own submission); otherwise a short note
  // says why it is missing.
  showPuzzleSection: boolean;
  // Copy question is only rendered when the caller established the viewer may review the copy.
  showCopySection: boolean;
  // "Saving updates your existing review" hint, shown when either level already exists.
  showUpdatesExisting: boolean;
  // DOM id for the puzzle review textarea; override when two hosts could coexist.
  puzzleTextId?: string;
}

// Presentational two-level review fields (puzzle question: stars + text; copy question: stars).
// Fully controlled — data fetching, seeding, and dirty tracking live in the host (the review
// dialog and the completion follow-up dialog).
export function TwoLevelReviewFields({
  puzzleRating,
  onPuzzleRatingChange,
  puzzleText,
  onPuzzleTextChange,
  copyRating,
  onCopyRatingChange,
  showPuzzleSection,
  showCopySection,
  showUpdatesExisting,
  puzzleTextId = "review-text",
}: TwoLevelReviewFieldsProps) {
  const t = useTranslations("solving.review");

  return (
    <div className="space-y-4">
      {showPuzzleSection ? (
        <div className="space-y-2">
          <Label htmlFor={puzzleTextId}>{t("puzzleQuestion")}</Label>
          <StarRating
            value={puzzleRating}
            onChange={onPuzzleRatingChange}
            size="lg"
            label={t("rating")}
          />
          <Textarea
            id={puzzleTextId}
            placeholder={t("textPlaceholder")}
            value={puzzleText}
            maxLength={REVIEW_TEXT_MAX_LENGTH}
            onChange={(e) => onPuzzleTextChange(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("puzzleNotReviewable")}
        </p>
      )}
      {showCopySection && (
        <div className="space-y-2">
          <Label>{t("copyQuestion")}</Label>
          <StarRating
            value={copyRating}
            onChange={onCopyRatingChange}
            size="lg"
            label={t("copyQuestion")}
          />
        </div>
      )}
      {showUpdatesExisting && (
        <p className="text-sm text-muted-foreground">{t("updatesExisting")}</p>
      )}
    </div>
  );
}
