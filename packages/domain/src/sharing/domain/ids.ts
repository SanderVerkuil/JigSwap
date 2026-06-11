import { Id } from "../../shared-kernel";

// This context's own aggregate/entity identities. Circle is the aggregate root; Membership is a
// child entity with its own identity (so admins can address a specific membership row).
export type CircleId = Id<"CircleId">;
export type MembershipId = Id<"MembershipId">;

// Foreign-aggregate references held as branded strings. Sharing never loads these aggregates; it
// only carries their ids. MemberId is owned by Identity & Access; CopyId is owned by Library.
// Defining them LOCALLY (not importing from the owning contexts) keeps the contexts decoupled —
// the cross-context link is by id only. (Barrel disambiguation is handled at integration.)
export type MemberId = Id<"MemberId">;
export type CopyId = Id<"CopyId">;
