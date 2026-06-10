import { toFollowId, toProfileId } from "../../../shared-kernel";
import { FollowId, ProfileId } from "../../domain";
import {
  FollowIdGenerator,
  ProfileIdGenerator,
} from "../ports/out/id-generators";

// Deterministic FollowIdGenerator for tests: follow-1, follow-2, ...
export class SequentialFollowIdGenerator implements FollowIdGenerator {
  private counter = 0;

  next(): FollowId {
    this.counter += 1;
    return toFollowId(`follow-${this.counter}`);
  }
}

// Deterministic ProfileIdGenerator for tests: profile-1, profile-2, ...
export class SequentialProfileIdGenerator implements ProfileIdGenerator {
  private counter = 0;

  next(): ProfileId {
    this.counter += 1;
    return toProfileId(`profile-${this.counter}`);
  }
}
