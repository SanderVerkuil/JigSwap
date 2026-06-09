import { MemberId } from "../../../domain";

// Outbound port: minting a new MemberId. The Member aggregate takes its id as input (it is pure
// and does no I/O), so the use case obtains one here. The convex adapter can back this with a
// pre-inserted document id or a uuid.
export interface MemberIdGenerator {
  next(): MemberId;
}
