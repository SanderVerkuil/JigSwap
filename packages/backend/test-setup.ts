import { afterEach } from "vitest";

// convex-test runs `ctx.scheduler.runAfter` jobs on real `setTimeout(0)` callbacks. Our mutations
// now schedule the event dispatcher, so a test that returns before those jobs run would let them
// fire AFTER teardown (when convex-test has reset its global), throwing "Write outside of
// transaction". Draining the macrotask queue at the end of every test lets each in-flight
// dispatcher finish inside its own test boundary. Tests that ASSERT on async effects still flush
// explicitly via `t.finishInProgressScheduledFunctions()`; this hook is the safety net for the
// rest (fire-and-forget events with no assertion).
afterEach(async () => {
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});
