import { convexErrorCode, rateLimitedRetryAt } from "@/lib/convex-error-code";
import { isUploadRateLimited } from "@/lib/upload-rate-limit";

// A failed cover step of a contribute flow (an uploaded box art's check, or a shop image's
// import), kept apart from the submission's own failure so a refusal names the right limit.
export class CoverStepError extends Error {
  constructor(readonly original: unknown) {
    super("The cover step failed");
  }
}

// Runs a contribute flow's cover step; its failure is rethrown as a CoverStepError. A refused
// upload URL stays as it is: it is the upload limit's refusal, with its own tag and message
// (lib/upload-rate-limit), not the cover-photo limit.
export async function coverStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (isUploadRateLimited(error)) throw error;
    throw new CoverStepError(error);
  }
}

// A failed copy step of the add form (the acquire after the filing), kept apart the same way: its
// RateLimited is the daily copy budget (backend lib/rateLimits.ts copyAdd), not the submission limit.
export class CopyStepError extends Error {
  constructor(readonly original: unknown) {
    super("The copy step failed");
  }
}

// The puzzles.* message for a failed contribute flow (cover step, then createPuzzle, then the add
// form's copy step): the member's limit on submissions (rateLimited) or on cover photos
// (coverRateLimited), each with when they can try again; the daily copy budget (addRateLimited,
// which says when by itself); a field the catalogue refuses as too long (textTooLong); a width or
// height it refuses (invalidDimensions); else the generic failure.
export type ContributeError =
  | { key: "rateLimited" | "coverRateLimited"; retryAt: number }
  | {
      key:
        | "addRateLimited"
        | "textTooLong"
        | "invalidDimensions"
        | "puzzleCreationFailed";
    };

export function contributeError(error: unknown, now: number): ContributeError {
  const fromCover = error instanceof CoverStepError;
  const fromCopy = error instanceof CopyStepError;
  const cause = fromCover || fromCopy ? error.original : error;
  if (fromCopy && convexErrorCode(cause) === "RateLimited") {
    return { key: "addRateLimited" };
  }
  const retryAt = rateLimitedRetryAt(cause, now);
  if (retryAt !== undefined) {
    return { key: fromCover ? "coverRateLimited" : "rateLimited", retryAt };
  }
  switch (convexErrorCode(cause)) {
    case "TextTooLong":
      return { key: "textTooLong" };
    case "InvalidDimensions":
      return { key: "invalidDimensions" };
    default:
      return { key: "puzzleCreationFailed" };
  }
}
