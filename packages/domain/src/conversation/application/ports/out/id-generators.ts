import { MessageId, ThreadId } from "../../../domain";

// Outbound ports: minting new ids. The aggregate and its messages take their id as input (they
// are pure and do no I/O), so the use case obtains one here. The 1b-convex adapter can back these
// with a pre-inserted document id or a uuid.
export interface ThreadIdGenerator {
  next(): ThreadId;
}

export interface MessageIdGenerator {
  next(): MessageId;
}
