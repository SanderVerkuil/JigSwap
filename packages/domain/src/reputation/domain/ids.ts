import { Id } from "../../shared-kernel";

// This context's own aggregate identities.
export type PartnerReviewId = Id<"PartnerReviewId">;
export type ReputationProfileId = Id<"ReputationProfileId">;

// Foreign-aggregate references held as branded strings. Reputation never loads these
// aggregates; it only carries their ids. MemberId is owned by Identity & Access; ExchangeId
// is owned by Exchange. Keeping them branded prevents mixing a member id where an exchange id
// is expected. (Barrel disambiguation is handled at integration.)
export type MemberId = Id<"MemberId">;
export type ExchangeId = Id<"ExchangeId">;
