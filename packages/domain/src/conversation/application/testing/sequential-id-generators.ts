import { toId } from "../../../shared-kernel";
import { MessageId, ThreadId } from "../../domain";
import { MessageIdGenerator, ThreadIdGenerator } from "../ports/out/id-generators";

// Deterministic ThreadIdGenerator for tests: thread-1, thread-2, ...
export class SequentialThreadIdGenerator implements ThreadIdGenerator {
  private counter = 0;

  next(): ThreadId {
    this.counter += 1;
    return toId<"ThreadId">(`thread-${this.counter}`) as ThreadId;
  }
}

// Deterministic MessageIdGenerator for tests: message-1, message-2, ...
export class SequentialMessageIdGenerator implements MessageIdGenerator {
  private counter = 0;

  next(): MessageId {
    this.counter += 1;
    return toId<"MessageId">(`message-${this.counter}`) as MessageId;
  }
}
