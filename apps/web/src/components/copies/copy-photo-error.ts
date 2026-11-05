import { convexErrorCode, rateLimitedRetryAt } from "@/lib/convex-error-code";

// The copyInstance message for a copy photo that could not be added (library/addCopyPhoto): the
// member's photo limit (RateLimited, with when they can try again), a copy that already has its
// maximum of photos (TooManyImages), or the generic failure for anything else.
export type CopyPhotoError =
  | { key: "photoRateLimited"; retryAt: number }
  | { key: "photoLimitReached" | "photoFailed" };

export function copyPhotoError(error: unknown, now: number): CopyPhotoError {
  const retryAt = rateLimitedRetryAt(error, now);
  if (retryAt !== undefined) return { key: "photoRateLimited", retryAt };
  return convexErrorCode(error) === "TooManyImages"
    ? { key: "photoLimitReached" }
    : { key: "photoFailed" };
}
