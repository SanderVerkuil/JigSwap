// View-model for a member card's rating stat. A star is only ever shown next to a real
// average: zero reviews is its own "none" state ("No reviews yet"), never "★–".
export type RatingView =
  { kind: "none" } | { kind: "rated"; value: number; count: number };

export function ratingView(stats: {
  averageRating: number;
  totalReviews: number;
}): RatingView {
  return stats.totalReviews > 0
    ? { kind: "rated", value: stats.averageRating, count: stats.totalReviews }
    : { kind: "none" };
}
