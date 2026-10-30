import { convexErrorCode } from "@/lib/convex-error-code";

// The copyInstance message for a copy photo that could not be added (library/addCopyPhoto):
// the member's photo limit (RateLimited), a copy that already has its maximum of photos
// (TooManyImages), or the generic failure for anything else.
export function copyPhotoErrorKey(
  error: unknown,
): "photoRateLimited" | "photoLimitReached" | "photoFailed" {
  switch (convexErrorCode(error)) {
    case "RateLimited":
      return "photoRateLimited";
    case "TooManyImages":
      return "photoLimitReached";
    default:
      return "photoFailed";
  }
}
