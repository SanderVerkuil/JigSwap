import { Id } from "../../shared-kernel";

// This context's own aggregate identities.
export type ProfileId = Id<"ProfileId">;
export type FollowId = Id<"FollowId">;
export type FollowRequestId = Id<"FollowRequestId">;
export type CommentId = Id<"CommentId">;
export type PhotoCommentId = Id<"PhotoCommentId">;

// Foreign-aggregate reference to a single uploaded PHOTO (an `ownedPuzzleImages` row), held as a
// branded string. A PhotoComment is posted against ONE specific photo (not a puzzle definition or an
// owned copy), so Social carries the PhotoId without ever loading the Library aggregate. PhotoId is
// owned by Library; keeping it branded prevents mixing it where one of this context's own ids is
// expected.
export type PhotoId = Id<"PhotoId">;

// Foreign-aggregate reference to a Catalog puzzle definition, held as a branded string. A Comment
// is posted against the puzzle DEFINITION (shared across every owned copy of it), so Social carries
// the PuzzleDefinitionId without ever loading the Catalog aggregate. PuzzleDefinitionId is owned by
// Catalog; keeping it branded prevents mixing it where one of this context's own ids is expected.
export type PuzzleDefinitionId = Id<"PuzzleDefinitionId">;

// Foreign-aggregate reference to a single owned COPY (an `ownedPuzzles` row), held as a branded
// string. A Comment may be SCOPED to one copy (the owner's own notes/rating on that copy) instead
// of the shared puzzle definition; when set, the comment is listed only on that copy and is excluded
// from the definition's community reviews/rating. CopyId is owned by Library.
export type CopyId = Id<"CopyId">;

// Foreign-aggregate reference held as a branded string. Social never loads the Member
// aggregate; it only carries its id. MemberId is owned by Identity & Access. Keeping it branded
// prevents mixing it where one of this context's own ids is expected. (Barrel disambiguation is
// handled at integration.)
export type MemberId = Id<"MemberId">;
