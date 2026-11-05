import { ConvexError } from "convex/values";

// The solving mutations map domain failures to `ConvexError<{ code, message }>` (see
// solving/errors.ts), keeping a stable code the UI can branch on. This pulls that code out
// safely so callers can surface the right message (e.g. the closed 24h edit window) without
// reaching into transport internals everywhere.
export function solvingErrorCode(error: unknown): string | undefined {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    if (data && typeof data.code === "string") return data.code;
  }
  return undefined;
}

// The key, in each solve form's own namespace, for a failed log or start. `RateLimited` is the
// daily solve budget (backend lib/rateLimits.ts solveLog): nothing was saved and retrying today
// won't help, so it gets its own message, as do a date or a solve time no solve can have (a year
// typed as 0226, say, which only the server refuses). Everything else is the form's generic save
// error.
export function solveSaveErrorKey(
  error: unknown,
): "rateLimited" | "invalidDate" | "invalidDuration" | "saveError" {
  switch (solvingErrorCode(error)) {
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
