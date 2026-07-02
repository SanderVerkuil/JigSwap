import { MemberId } from "../../../domain";

// Outbound policy port: may `initiator` open a DM with `recipient`? The Convex adapter answers
// "connected" = mutual follow, shared circle, or any existing thread between the pair. Mirrors
// the VisibilityPolicy pattern: the domain never queries follows/circles itself.
export interface ConnectionPolicy {
  canMessage(initiator: MemberId, recipient: MemberId): Promise<boolean>;
}
