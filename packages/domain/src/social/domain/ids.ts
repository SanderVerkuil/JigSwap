import { Id } from "../../shared-kernel";

// This context's own aggregate identities.
export type ProfileId = Id<"ProfileId">;
export type FollowId = Id<"FollowId">;

// Foreign-aggregate reference held as a branded string. Social never loads the Member
// aggregate; it only carries its id. MemberId is owned by Identity & Access. Keeping it branded
// prevents mixing it where one of this context's own ids is expected. (Barrel disambiguation is
// handled at integration.)
export type MemberId = Id<"MemberId">;
