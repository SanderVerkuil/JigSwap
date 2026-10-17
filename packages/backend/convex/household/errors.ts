import type {
  HouseholdApplicationError,
  HouseholdError,
} from "@jigswap/domain";
import { ConvexError } from "convex/values";

// Map a Household domain/application error to a transport error, preserving the stable `code` so
// the UI can branch on it.
export const toConvexError = (
  error: HouseholdError | HouseholdApplicationError,
): ConvexError<{ code: string; message: string }> =>
  new ConvexError({ code: error.code, message: error.message });
