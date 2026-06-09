import { Id } from "../../shared-kernel";

// Identity & Access is the CANONICAL owner of MemberId: a Member is the internal identity this
// context mints for each Clerk subject, and every other context references members by this id.
// (Other contexts currently declare a local MemberId; the root barrel re-points to this source
// at integration.)
export type MemberId = Id<"MemberId">;
