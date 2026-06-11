import { err, ok, Result } from "../../shared-kernel";
import { ReputationError } from "./errors";
import { StarRating } from "./star-rating";

// The four sub-scores carried by a PartnerReview, matching the `reviews.categories` column
// (communication, packaging, condition, timeliness). Each is a validated 1-5 StarRating.
export interface PartnerReviewScoresInput {
  readonly communication: number;
  readonly packaging: number;
  readonly condition: number;
  readonly timeliness: number;
}

// Immutable value object grouping the four category sub-scores. Constructed only via
// `create`, which validates every sub-score; an invalid one fails the whole VO.
export class PartnerReviewScores {
  private constructor(
    readonly communication: StarRating,
    readonly packaging: StarRating,
    readonly condition: StarRating,
    readonly timeliness: StarRating,
  ) {}

  static create(
    input: PartnerReviewScoresInput,
  ): Result<PartnerReviewScores, ReputationError> {
    const communication = StarRating.create(input.communication);
    if (communication.isErr) return err(communication.error);
    const packaging = StarRating.create(input.packaging);
    if (packaging.isErr) return err(packaging.error);
    const condition = StarRating.create(input.condition);
    if (condition.isErr) return err(condition.error);
    const timeliness = StarRating.create(input.timeliness);
    if (timeliness.isErr) return err(timeliness.error);

    return ok(
      new PartnerReviewScores(
        communication.value,
        packaging.value,
        condition.value,
        timeliness.value,
      ),
    );
  }
}
