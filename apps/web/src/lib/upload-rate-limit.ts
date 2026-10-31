import { ConvexError } from "convex/values";

// The shared upload URL (gateway.library.generateUploadUrl, behind copy photos, completion photos
// and box art) is rate limited per member (backend lib/rateLimits: uploadUrl per hour,
// uploadUrlDaily per day) and refuses with ConvexError({ code: "RateLimited" }). The upload flows
// show common.photoUploadRateLimited for it, so the member waits instead of retrying into the
// limit.
//
// Each flow mints its URL through mintUploadUrl, which turns that refusal into an
// UploadRateLimitedError. A flow's later steps (an attach, a catalogue submit, a proposal) may get
// RateLimited refusals of their own; those stay plain ConvexErrors, so isUploadRateLimited is
// false for them and they keep their own message.

const isRateLimited = (error: unknown): boolean =>
  error instanceof ConvexError &&
  typeof error.data === "object" &&
  error.data !== null &&
  (error.data as { code?: unknown }).code === "RateLimited";

/** The upload URL itself was refused by the member's upload limit. */
export class UploadRateLimitedError extends Error {
  constructor(cause: unknown) {
    super("Upload URL refused by the upload rate limit", { cause });
    this.name = "UploadRateLimitedError";
  }
}

/** Mint an upload URL; the upload limit's refusal rejects as UploadRateLimitedError. */
export async function mintUploadUrl<T>(mint: () => Promise<T>): Promise<T> {
  try {
    return await mint();
  } catch (error) {
    if (isRateLimited(error)) throw new UploadRateLimitedError(error);
    throw error;
  }
}

/** True only for a refusal of the upload URL (see mintUploadUrl), never for a later step's. */
export const isUploadRateLimited = (error: unknown): boolean =>
  error instanceof UploadRateLimitedError;
