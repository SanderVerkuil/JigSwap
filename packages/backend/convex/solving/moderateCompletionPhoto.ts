import { v } from "convex/values";
import { internalAction } from "../_generated/server";

// Stub — filled in by the moderation task. Scheduling asserts in tests never drain this.
export const moderateCompletionPhoto = internalAction({
  args: { imageId: v.id("completionImages") },
  handler: async () => {},
});
