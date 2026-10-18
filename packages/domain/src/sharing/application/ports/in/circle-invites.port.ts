import { Result } from "../../../../shared-kernel";
import {
  CircleId,
  CircleInviteId,
  MemberId,
  PermissionLevel,
  SharingError,
} from "../../../domain";
import { SharingApplicationError } from "../../errors";

// Inbound ports for circle invitations. `actorId` is ALWAYS the authenticated member, resolved by
// the composition root, never a client-supplied id.
type Outcome<T> = Promise<Result<T, SharingError | SharingApplicationError>>;

export interface InviteToCircleCommand {
  readonly circleId: CircleId;
  readonly actorId: MemberId;
  readonly inviteeId: MemberId;
  readonly permission: PermissionLevel;
}
// Resolves to the invite's id: a new one, or the open invite already pending for this invitee.
export type InviteToCircle = (
  cmd: InviteToCircleCommand,
) => Outcome<CircleInviteId>;

export interface CircleInviteCommand {
  readonly actorId: MemberId;
  readonly inviteId: CircleInviteId;
}
// Resolves to the circle the invitee joined.
export type AcceptCircleInvite = (
  cmd: CircleInviteCommand,
) => Outcome<CircleId>;
export type DeclineCircleInvite = (cmd: CircleInviteCommand) => Outcome<void>;
export type RevokeCircleInvite = (cmd: CircleInviteCommand) => Outcome<void>;

// System-driven (scheduled at expiresAt): resolves to whether the invite was flipped to expired.
export type ExpireCircleInvite = (cmd: {
  readonly inviteId: CircleInviteId;
}) => Promise<boolean>;
