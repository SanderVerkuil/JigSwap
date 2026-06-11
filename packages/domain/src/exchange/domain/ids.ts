import { Id } from "../../shared-kernel";

// The Exchange aggregate's own identity.
export type ExchangeId = Id<"ExchangeId">;

// Foreign-aggregate references held as branded strings. The Exchange context never
// loads these aggregates; it only carries their ids. MemberId is owned by Identity &
// Access; CopyId is owned by Personal Library. Keeping them branded prevents mixing
// a member id where a copy id is expected.
export type MemberId = Id<"MemberId">;
export type CopyId = Id<"CopyId">;
