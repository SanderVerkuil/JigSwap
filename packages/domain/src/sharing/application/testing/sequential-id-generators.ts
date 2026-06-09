import { toId } from "../../../shared-kernel";
import { CircleId, MembershipId } from "../../domain";
import { CircleIdGenerator, MembershipIdGenerator } from "../ports/out/id-generators";

// Deterministic CircleIdGenerator for tests: circle-1, circle-2, ...
export class SequentialCircleIdGenerator implements CircleIdGenerator {
  private counter = 0;

  next(): CircleId {
    this.counter += 1;
    return toId<"CircleId">(`circle-${this.counter}`) as CircleId;
  }
}

// Deterministic MembershipIdGenerator for tests: membership-1, membership-2, ...
export class SequentialMembershipIdGenerator implements MembershipIdGenerator {
  private counter = 0;

  next(): MembershipId {
    this.counter += 1;
    return toId<"MembershipId">(`membership-${this.counter}`) as MembershipId;
  }
}
