import type { Clock } from "@jigswap/domain";

// Driven adapter for the Clock port: real wall-clock time, kept out of the domain so
// use cases stay deterministic and testable with a fixed clock.
export const systemClock: Clock = {
  now: () => new Date(),
};
