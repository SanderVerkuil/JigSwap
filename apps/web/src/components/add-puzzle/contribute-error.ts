import { convexErrorCode } from "@/lib/convex-error-code";

// The puzzles.* message for a failed contribute flow (box-art upload, then createPuzzle): the
// member's limit on submissions or box-art checks (RateLimited), a field the catalogue refuses
// as too long (TextTooLong), else the generic failure.
export function contributeErrorKey(
  error: unknown,
): "rateLimited" | "textTooLong" | "puzzleCreationFailed" {
  switch (convexErrorCode(error)) {
    case "RateLimited":
      return "rateLimited";
    case "TextTooLong":
      return "textTooLong";
    default:
      return "puzzleCreationFailed";
  }
}
