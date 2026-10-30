import { ConvexError } from "convex/values";

type RefusalData = { code?: unknown; retryAfterMs?: unknown } | null;

const refusalData = (error: unknown): RefusalData =>
  error instanceof ConvexError && typeof error.data === "object"
    ? (error.data as RefusalData)
    : null;

// The code of a refusal a Convex function threw as ConvexError({ code, ... }), or undefined for
// anything else (a network failure, a validator error, a bug).
export function convexErrorCode(error: unknown): string | undefined {
  const code = refusalData(error)?.code;
  return typeof code === "string" ? code : undefined;
}

// How long the refusal asks the caller to wait (ConvexError({ retryAfterMs })), if it says.
export function convexRetryAfterMs(error: unknown): number | undefined {
  const wait = refusalData(error)?.retryAfterMs;
  return typeof wait === "number" ? wait : undefined;
}
