import { Id } from "../../shared-kernel";

// This context's own aggregate identities.
export type ProfileId = Id<"ProfileId">;
export type FollowId = Id<"FollowId">;
export type CommentId = Id<"CommentId">;

// Foreign-aggregate reference to a Catalog puzzle definition, held as a branded string. A Comment
// is posted against the puzzle DEFINITION (shared across every owned copy of it), so Social carries
// the PuzzleDefinitionId without ever loading the Catalog aggregate. PuzzleDefinitionId is owned by
// Catalog; keeping it branded prevents mixing it where one of this context's own ids is expected.
export type PuzzleDefinitionId = Id<"PuzzleDefinitionId">;

// Foreign-aggregate reference held as a branded string. Social never loads the Member
// aggregate; it only carries its id. MemberId is owned by Identity & Access. Keeping it branded
// prevents mixing it where one of this context's own ids is expected. (Barrel disambiguation is
// handled at integration.)
export type MemberId = Id<"MemberId">;
