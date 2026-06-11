import { CircleId, MembershipId } from "../../../domain";

// Outbound ports: minting new aggregate/entity ids. The aggregate's factories take their id as
// input (they are pure and do no I/O), so the use cases obtain one here. The backend adapter can
// back these with a pre-inserted document id or a uuid.
export interface CircleIdGenerator {
  next(): CircleId;
}

export interface MembershipIdGenerator {
  next(): MembershipId;
}
