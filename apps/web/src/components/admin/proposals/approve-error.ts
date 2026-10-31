import { convexErrorCode } from "@/lib/convex-error-code";

// The admin.proposals message for a failed approval. A suggestion filed before the catalogue's
// text bounds existed (SEC-26) can carry text the definition now refuses (TextTooLong); retrying
// can't fix that, so the admin is told to decline it. Anything else is the generic failure.
export const approveErrorKey = (
  error: unknown,
): "approveTextTooLong" | "actionFailed" =>
  convexErrorCode(error) === "TextTooLong"
    ? "approveTextTooLong"
    : "actionFailed";
