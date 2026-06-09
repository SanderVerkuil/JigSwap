import { Clock } from "../../../shared-kernel";

// A Clock that returns a fixed instant, keeping use-case tests deterministic. The instant can
// be advanced for flows that span time (e.g. asserting a later read receipt).
export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return this.instant;
  }

  set(instant: Date): void {
    this.instant = instant;
  }
}
