import { Id } from "../../shared-kernel";

// This context's own aggregate identities. Household is the membership aggregate; an invite is its
// own aggregate (it lives and resolves independently of the household's member list).
export type HouseholdId = Id<"HouseholdId">;
export type HouseholdInviteId = Id<"HouseholdInviteId">;

// Foreign-aggregate reference held as a branded string. MemberId is owned by Identity & Access;
// Household only carries it. (Barrel disambiguation is handled at the package root.)
export type MemberId = Id<"MemberId">;
