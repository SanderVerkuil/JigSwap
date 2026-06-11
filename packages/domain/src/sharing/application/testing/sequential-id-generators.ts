import { toCircleId, toMembershipId } from "../../../shared-kernel";
import { CircleId, MembershipId } from "../../domain";
import {
  CircleIdGenerator,
  MembershipIdGenerator,
} from "../ports/out/id-generators";

// Deterministic CircleIdGenerator for tests: circle-1, circle-2, ...
export class SequentialCircleIdGenerator implements CircleIdGenerator {
  private counter = 0;

  next(): CircleId {
    this.counter += 1;
    return toCircleId(`circle-${this.counter}`);
  }
}

// Deterministic MembershipIdGenerator for tests: membership-1, membership-2, ...
export class SequentialMembershipIdGenerator implements MembershipIdGenerator {
  private counter = 0;

  next(): MembershipId {
    this.counter += 1;
    return toMembershipId(`membership-${this.counter}`);
  }
}
