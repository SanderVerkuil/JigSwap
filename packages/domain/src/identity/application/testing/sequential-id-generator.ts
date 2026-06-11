import { toMemberId } from "../../../shared-kernel";
import { MemberId } from "../../domain";
import { MemberIdGenerator } from "../ports/out/id-generator";

// Deterministic MemberIdGenerator for tests: member-1, member-2, ...
export class SequentialMemberIdGenerator implements MemberIdGenerator {
  private counter = 0;

  next(): MemberId {
    this.counter += 1;
    return toMemberId(`member-${this.counter}`);
  }
}
