import { CircleId, CircleParticipant } from "../../domain";
import { CircleRoster } from "../ports/out/circle-roster";

// In-memory CircleRoster for use-case tests: circles are registered with their members; an
// unregistered circle answers null (no such circle).
export class InMemoryCircleRoster implements CircleRoster {
  private readonly circles = new Map<CircleId, readonly CircleParticipant[]>();

  async membersOf(
    circleId: CircleId,
  ): Promise<readonly CircleParticipant[] | null> {
    return this.circles.get(circleId) ?? null;
  }

  // Test helper: register (or replace) a circle's current members.
  set(circleId: CircleId, members: readonly CircleParticipant[]): void {
    this.circles.set(circleId, members);
  }
}
