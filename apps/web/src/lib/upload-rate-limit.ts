import { ConvexError } from "convex/values";

// The shared upload URL (gateway.library.generateUploadUrl, behind copy photos, completion photos
// and box art) is rate limited per member (backend lib/rateLimits: uploadUrl per hour,
// uploadUrlDaily per day) and refuses with ConvexError({ code: "RateLimited" }). The upload flows
// show common.photoUploadRateLimited for it, so the member waits instead of retrying into the
// limit.
export const isRateLimited = (error: unknown): boolean =>
  error instanceof ConvexError &&
  typeof error.data === "object" &&
  error.data !== null &&
  (error.data as { code?: unknown }).code === "RateLimited";
