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
