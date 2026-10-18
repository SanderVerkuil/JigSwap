"use node";

import { clerkInvitationGateway } from "./clerkInvitationGateway";

// Outbound port to the identity provider's invitation system (Clerk). It keeps track of the
// invitation and its sign-up link; we send the email ourselves.

export interface CreateInvitationInput {
  readonly email: string;
  readonly redirectUrl: string;
  readonly expiresInDays: number;
  /** Becomes the new member's public metadata on sign-up. Only our opaque ref, never names. */
  readonly publicMetadata: Record<string, unknown>;
}

export type CreateInvitationResult =
  /** Created, with the link our email carries. */
  | { readonly kind: "created"; readonly id: string; readonly url: string }
  /** The address is already invited or already has an account: nothing was created. */
  | { readonly kind: "exists" }
  /** Created, but without a link: unusable for our email. */
  | { readonly kind: "no_url"; readonly id: string };

export interface InvitationGateway {
  /** Create an invitation WITHOUT the provider's own email. Throws on any other failure. */
  create(input: CreateInvitationInput): Promise<CreateInvitationResult>;
  /** Revoke an invitation so its link stops working. Throws on failure. */
  revoke(id: string): Promise<void>;
}

// The configured adapter. Env is read lazily per call (repo convention). Tests replace this
// factory with adapters/fakeInvitationGateway (vi.mock), so no test ever reaches Clerk.
export const makeInvitationGatewayFromEnv = (
  env: Record<string, string | undefined> = process.env,
): InvitationGateway =>
  clerkInvitationGateway({ secretKey: env["CLERK_SECRET_KEY"] });
