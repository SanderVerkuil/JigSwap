import { ConvexError } from "convex/values";

// The longest a new circle's name may be, counted after the domain normalises it. Mirrors the
// domain's MAX_CIRCLE_NAME_LENGTH; createCircle refuses anything longer with InvalidCircleName.
export const MAX_CIRCLE_NAME_LENGTH = 100;

// Whether createCircle refused the name (nothing visible, or over the limit once normalised).
export function isInvalidCircleName(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data = error.data as { code?: unknown } | undefined;
  return data?.code === "InvalidCircleName";
}
