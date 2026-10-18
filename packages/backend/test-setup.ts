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

// #178: anonRef is an HMAC keyed by the server-only ANON_REF_SECRET. A dummy, NON-SECRET value for
// tests only (≥ 32 chars, the production minimum); real deployments set their own via `convex env`.
// Assigned unconditionally so a value exported in the developer's shell never leaks into tests.
process.env.ANON_REF_SECRET =
  "test-only-dummy-anon-ref-secret-not-used-anywhere-real";
