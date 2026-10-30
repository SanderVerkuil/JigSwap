import { ConvexError } from "convex/values";

type RefusalData = { code?: unknown; retryAfterMs?: unknown } | null;

// The structured data of a ConvexError, which may arrive JSON-encoded; null for anything else.
const refusalData = (error: unknown): RefusalData => {
  if (!(error instanceof ConvexError)) return null;
  let data: unknown = error.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === "object" ? (data as RefusalData) : null;
};

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
