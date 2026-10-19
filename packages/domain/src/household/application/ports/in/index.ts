import { Result } from "../../../../shared-kernel";
import {
  HouseholdCopyPermission,
  HouseholdError,
  HouseholdId,
  HouseholdInviteId,
  MemberId,
} from "../../../domain";
import { HouseholdApplicationError } from "../../errors";

// Inbound ports (driving side). `actorId` is ALWAYS the authenticated member, resolved by the
// composition root — never a client-supplied id.
type Outcome<T> = Promise<
  Result<T, HouseholdError | HouseholdApplicationError>
>;

export interface CreateHouseholdCommand {
  readonly actorId: MemberId;
}
export type CreateHousehold = (
  cmd: CreateHouseholdCommand,
) => Outcome<HouseholdId>;

export interface InviteToHouseholdCommand {
  readonly actorId: MemberId;
  readonly inviteeId: MemberId;
}
export type InviteToHousehold = (
  cmd: InviteToHouseholdCommand,
) => Outcome<HouseholdInviteId>;

export interface RespondToHouseholdInviteCommand {
  readonly actorId: MemberId;
  readonly inviteId: HouseholdInviteId;
}
export type AcceptHouseholdInvite = (
  cmd: RespondToHouseholdInviteCommand,
) => Outcome<HouseholdId>;
export type DeclineHouseholdInvite = (
  cmd: RespondToHouseholdInviteCommand,
) => Outcome<void>;

// An existing member accepts a household invite link minted by `inviterId` (the link's owner,
// read server-side from the token, never from the client).
export interface JoinHouseholdByLinkCommand {
  readonly actorId: MemberId;
  readonly inviterId: MemberId;
}
export type JoinHouseholdByLink = (
  cmd: JoinHouseholdByLinkCommand,
) => Outcome<HouseholdId>;

export interface LeaveHouseholdCommand {
  readonly actorId: MemberId;
}
export type LeaveHousehold = (
  cmd: LeaveHouseholdCommand,
) => Outcome<{ readonly dissolved: boolean }>;

export interface RemoveHouseholdMemberCommand {
  readonly actorId: MemberId;
  readonly memberId: MemberId;
}
export type RemoveHouseholdMember = (
  cmd: RemoveHouseholdMemberCommand,
) => Outcome<void>;

export interface SetHouseholdDefaultCopyPermissionCommand {
  readonly actorId: MemberId;
  readonly permission: HouseholdCopyPermission;
}
export type SetHouseholdDefaultCopyPermission = (
  cmd: SetHouseholdDefaultCopyPermissionCommand,
) => Outcome<{ readonly changed: boolean }>;

export interface RenameHouseholdCommand {
  readonly actorId: MemberId;
  // null clears the name.
  readonly name: string | null;
}
export type RenameHousehold = (cmd: RenameHouseholdCommand) => Outcome<void>;
