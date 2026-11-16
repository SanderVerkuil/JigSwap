import { convexErrorCode } from "@/lib/convex-error-code";

// The key, in each solve form's own namespace, for a failed log or start. `RateLimited` is the
// daily solve budget (backend lib/rateLimits.ts solveLog): nothing was saved and retrying today
// won't help, so it gets its own message, as do a date or a solve time no solve can have (a year
// typed as 0226, say, which only the server refuses). Everything else is the form's generic save
// error.
export function solveSaveErrorKey(
  error: unknown,
): "rateLimited" | "invalidDate" | "invalidDuration" | "saveError" {
  switch (convexErrorCode(error)) {
    case "RateLimited":
      return "rateLimited";
    case "InvalidSolveDate":
      return "invalidDate";
    case "InvalidDuration":
      return "invalidDuration";
    default:
      return "saveError";
  }
}
