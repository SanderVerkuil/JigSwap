"use node";

import {
  clerkInvitationGateway,
  invitationErrorCode,
} from "./clerkInvitationGateway";

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
  /**
   * Delete an invitation and the provider's stored copy of its email (the address). Throws on
   * failure.
   */
  delete(id: string): Promise<void>;
}

// The configured adapter. Env is read lazily per call (repo convention). Tests replace this
// factory with adapters/fakeInvitationGateway (vi.mock), so no test ever reaches Clerk.
export const makeInvitationGatewayFromEnv = (
  env: Record<string, string | undefined> = process.env,
): InvitationGateway =>
  clerkInvitationGateway({ secretKey: env["CLERK_SECRET_KEY"] });

/**
 * Retire an invitation we no longer want: revoke it (the link stops working), then delete it (the
 * provider drops its record of the address). Each step is best-effort; returns the error codes of
 * the steps that failed, for the caller's wide event. TO VERIFY (spec E.0, 3): whether delete
 * alone is enough.
 */
export const retireInvitation = async (
  gateway: InvitationGateway,
  id: string,
): Promise<{ revoke?: string; delete?: string }> => {
  const errors: { revoke?: string; delete?: string } = {};
  try {
    await gateway.revoke(id);
  } catch (error) {
    errors.revoke = invitationErrorCode(error);
  }
  try {
    await gateway.delete(id);
  } catch (error) {
    errors.delete = invitationErrorCode(error);
  }
  return errors;
};
