import { v } from "convex/values";
import { internalAction } from "../_generated/server";

// Knock (knock.app) powers the out-of-band channels (email/push). Each delivery triggers ONE
// workflow run with `data.channel` set, so the Knock workflow branches per channel with step
// conditions (e.g. `data.channel == "email"`). The in-app feed stays on Convex (inAppChannel);
// Knock is deliberately additive and the integration is env-gated: without KNOCK_API_KEY on the
// deployment this action is a logged no-op, so dev/preview deployments need no Knock account.

const KNOCK_API_URL = "https://api.knock.app/v1";
const DEFAULT_WORKFLOW_KEY = "app-notification";

export const buildTriggerPayload = (args: {
  channel: string;
  type: string;
  title: string;
  message: string;
  relatedId?: string;
  recipient: { id: string; email: string; name: string };
}) => ({
  // Inline-identified recipient: Knock upserts the user on trigger, so no separate
  // identify call (and no drift) is needed.
  recipients: [
    {
      id: args.recipient.id,
      email: args.recipient.email,
      name: args.recipient.name,
    },
  ],
  data: {
    channel: args.channel,
    type: args.type,
    title: args.title,
    message: args.message,
    relatedId: args.relatedId,
  },
});

export const trigger = internalAction({
  args: {
    channel: v.union(v.literal("email"), v.literal("push")),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    relatedId: v.optional(v.string()),
    recipient: v.object({
      id: v.string(),
      email: v.string(),
      name: v.string(),
    }),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.KNOCK_API_KEY;
    if (!apiKey) {
      console.warn(
        `Knock is not configured (KNOCK_API_KEY unset); dropping ${args.channel} notification "${args.type}" for user ${args.recipient.id}.`,
      );
      return;
    }
    const workflowKey = process.env.KNOCK_WORKFLOW_KEY ?? DEFAULT_WORKFLOW_KEY;
    const response = await fetch(
      `${KNOCK_API_URL}/workflows/${workflowKey}/trigger`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTriggerPayload(args)),
      },
    );
    if (!response.ok) {
      // Throw so the scheduler surfaces the failure in the Convex dashboard; the in-app
      // notification row is unaffected (it was persisted in the originating mutation).
      throw new Error(
        `Knock trigger failed (${response.status}): ${await response.text()}`,
      );
    }
  },
});
