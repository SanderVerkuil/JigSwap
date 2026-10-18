"use node";

import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { InvitationGateway } from "./invitationGateway";

// Clerk's answers when the address was already invited or already belongs to a user. We never
// pass `ignoreExisting`, so Clerk refuses instead of creating a second invitation.
// TO VERIFY on the dev instance (spec E.0): the exact codes for both cases.
const ALREADY_EXISTS_CODES: ReadonlySet<string> = new Set([
  "duplicate_record",
  "form_identifier_exists",
]);

const isAlreadyExists = (error: unknown): boolean =>
  isClerkAPIResponseError(error) &&
  error.errors.some((e) => ALREADY_EXISTS_CODES.has(e.code));

/** A loggable code for a gateway failure: Clerk's error code or the error's name, never its message. */
export const invitationErrorCode = (error: unknown): string =>
  isClerkAPIResponseError(error)
    ? (error.errors[0]?.code ?? `clerk_${error.status}`)
    : error instanceof Error
      ? error.name
      : "unknown";

// The InvitationGateway over Clerk's Backend API. `notify: false`: Clerk sends no email of its own.
export const clerkInvitationGateway = (config: {
  readonly secretKey: string | undefined;
}): InvitationGateway => {
  const clerk = () => createClerkClient({ secretKey: config.secretKey });
  return {
    async create({ email, redirectUrl, expiresInDays, publicMetadata }) {
      try {
        const invitation = await clerk().invitations.createInvitation({
          emailAddress: email,
          redirectUrl,
          expiresInDays,
          publicMetadata,
          notify: false,
        });
        // TO VERIFY (spec E.0, 1): Clerk returns `url` with notify: false.
        return invitation.url
          ? { kind: "created", id: invitation.id, url: invitation.url }
          : { kind: "no_url", id: invitation.id };
      } catch (error) {
        if (isAlreadyExists(error)) return { kind: "exists" };
        throw error;
      }
    },
    async revoke(id) {
      await clerk().invitations.revokeInvitation(id);
    },
    async delete(id) {
      // Also deletes "the copies of the invitation email Clerk stored for its recipient".
      await clerk().invitations.deleteInvitation(id);
    },
    async clearInviteMetadata(clerkUserId) {
      // Clerk merges publicMetadata, and a null value deletes the key.
      await clerk().users.updateUserMetadata(clerkUserId, {
        publicMetadata: { jsInvite: null },
      });
    },
  };
};
