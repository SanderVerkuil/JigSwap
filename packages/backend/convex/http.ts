import type { WebhookEvent } from "@clerk/backend";
import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { signupInviteOf } from "./invitations/applySignupInvite";

const handleClerkWebhook = httpAction(async (ctx, request) => {
  // Read the secret per-request (NOT at module scope) so a deployment without it — e.g. a preview
  // deployment, which never receives Clerk webhooks and is seeded from a dev snapshot instead —
  // still deploys and serves everything else.
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (webhookSecret === undefined) {
    console.warn(
      "CLERK_WEBHOOK_SECRET not set — Clerk webhook ignored (expected on preview deployments)",
    );
    return new Response("Clerk webhook not configured", {
      status: 503,
    });
  }
  const event = await validateRequest(request, webhookSecret);
  if (!event) {
    return new Response("Error occured", {
      status: 400,
    });
  }
  switch (event.type) {
    case "user.created": // intentional fallthrough
    case "user.updated": {
      const existingUser = await ctx.runQuery(internal.users.getUser, {
        subject: event.data.id,
      });
      if (existingUser && event.type === "user.created") {
        console.warn("Overwriting user", event.data.id, "with", event.data);
      }
      console.log("creating/updating user", event.data.id);
      await ctx.runMutation(internal.users.updateOrCreateUser, {
        clerkUser: event.data,
      });
      if (event.type === "user.created") {
        await applySignupInviteOf(
          ctx,
          event.data.id,
          event.data.public_metadata,
        );
      }
      break;
    }
    case "user.deleted": {
      // Clerk docs say this is required, but the types say optional?
      const id = event.data.id!;
      await ctx.runMutation(internal.users.deleteUser, { id });
      break;
    }
    default: {
      console.log("ignored Clerk webhook event", event.type);
    }
  }
  return new Response(null, {
    status: 200,
  });
});

// A new member who signed up through an email invitation carries its { jsInvite: { kind, ref } }
// in their public metadata, which only our Backend API calls can write. Anything malformed is
// ignored, and a failure never fails the user sync (svix would redeliver the whole event).
async function applySignupInviteOf(
  ctx: ActionCtx,
  clerkUserId: string,
  publicMetadata: unknown,
): Promise<void> {
  const invite = signupInviteOf(publicMetadata);
  if (invite === null) return;
  try {
    await ctx.runMutation(
      internal.invitations.applySignupInvite.applySignupInvite,
      { clerkUserId, ...invite },
    );
  } catch (error) {
    console.error(
      "applySignupInvite failed for invite",
      invite.ref,
      error instanceof Error ? error.name : "unknown",
    );
  }
}

const http = httpRouter();
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: handleClerkWebhook,
});

async function validateRequest(
  req: Request,
  webhookSecret: string,
): Promise<WebhookEvent | undefined> {
  const payloadString = await req.text();

  const svixHeaders = {
    "svix-id": req.headers.get("svix-id")!,
    "svix-timestamp": req.headers.get("svix-timestamp")!,
    "svix-signature": req.headers.get("svix-signature")!,
  };
  const wh = new Webhook(webhookSecret);
  try {
    // svix 2: verify() only throws on a bad signature and no longer returns the payload.
    wh.verify(payloadString, svixHeaders);
  } catch (_) {
    console.log("error verifying");
    return;
  }

  return JSON.parse(payloadString) as WebhookEvent;
}

export default http;
