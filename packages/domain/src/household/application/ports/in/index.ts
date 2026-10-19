import { Result } from "../../../../shared-kernel";
import {
  HouseholdCopyPermission,
  HouseholdError,
  HouseholdId,
  HouseholdInviteId,
  HouseholdJoinRequestId,
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
// An invitee already in another household joins only with leaveCurrentHousehold: they leave it
// (dissolving it if they are its last member) and join in the same step, or nothing changes.
export interface AcceptHouseholdInviteCommand extends RespondToHouseholdInviteCommand {
  readonly leaveCurrentHousehold?: boolean;
}
export type AcceptHouseholdInvite = (
  cmd: AcceptHouseholdInviteCommand,
) => Outcome<HouseholdId>;
export type DeclineHouseholdInvite = (
  cmd: RespondToHouseholdInviteCommand,
) => Outcome<void>;

// The household admin withdraws a pending invite their household sent.
export interface RevokeHouseholdInviteCommand {
  readonly actorId: MemberId;
  readonly inviteId: HouseholdInviteId;
}
export type RevokeHouseholdInvite = (
  cmd: RevokeHouseholdInviteCommand,
) => Outcome<void>;

// An existing member accepts a household invite link minted by `inviterId` (the link's owner,
// read server-side from the token, never from the client).
export interface JoinHouseholdByLinkCommand {
  readonly actorId: MemberId;
  readonly inviterId: MemberId;
  // As for AcceptHouseholdInvite: leave the actor's current household as part of the join.
  readonly leaveCurrentHousehold?: boolean;
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

// A member asks to join the household an expired or used invite link was minted for. The
// composition root resolves the link server-side: `householdId` and `adminId` (its owner) are never
// client-supplied. `blocked` is whether the requester and the admin are blocked either way. The
// answer never says whether the request reached anyone: a request to a household that is gone, an
// owner who is no longer its admin, or a blocked pair is stored as dropped and told to no one.
export interface RequestToJoinHouseholdCommand {
  readonly actorId: MemberId;
  readonly householdId: HouseholdId;
  readonly adminId: MemberId;
  readonly linkId: string;
  readonly blocked: boolean;
  // Required (true) when the actor is in a household now: approval would make them leave it.
  readonly leaveCurrentHousehold?: boolean;
}
export type RequestToJoinHousehold = (
  cmd: RequestToJoinHouseholdCommand,
) => Outcome<HouseholdJoinRequestId>;

export interface RespondToHouseholdJoinRequestCommand {
  readonly actorId: MemberId;
  readonly requestId: HouseholdJoinRequestId;
}
// `blocked`: the approver and the requester are blocked either way (approval then closes).
export interface ApproveHouseholdJoinRequestCommand extends RespondToHouseholdJoinRequestCommand {
  readonly blocked: boolean;
}
// "closed" is one answer for every request that can no longer be approved (withdrawn, declined,
// lapsed, or the requester's household situation no longer matches their consent), so the admin
// never learns which.
export type HouseholdJoinRequestOutcome = "joined" | "closed";
export type ApproveHouseholdJoinRequest = (
  cmd: ApproveHouseholdJoinRequestCommand,
) => Outcome<HouseholdJoinRequestOutcome>;
export type DeclineHouseholdJoinRequest = (
  cmd: RespondToHouseholdJoinRequestCommand,
) => Outcome<void>;
export type WithdrawHouseholdJoinRequest = (
  cmd: RespondToHouseholdJoinRequestCommand,
) => Outcome<void>;
