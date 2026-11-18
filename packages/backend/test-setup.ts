import { afterEach, expect } from "vitest";

// convex-test only console.errors a crashing scheduled function and marks it failed, so the test
// would pass. A plain wrapper (not vi.spyOn: per-file restoreAllMocks would undo it) records those
// lines; afterEach fails the test. Known gap: files that mock console.error themselves hide crashes.
const scheduledCrashes: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (String(args[0]).startsWith("Error when running scheduled function")) {
    scheduledCrashes.push(String(args[0]));
  }
  originalConsoleError(...args);
};

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
  const crashes = scheduledCrashes.splice(0);
  expect(crashes, "a scheduled function crashed during this test").toEqual([]);
});

// #178: anonRef is an HMAC keyed by the server-only ANON_REF_SECRET. A dummy, NON-SECRET value for
// tests only (≥ 32 chars, the production minimum); real deployments set their own via `convex env`.
// Assigned unconditionally so a value exported in the developer's shell never leaks into tests.
process.env.ANON_REF_SECRET =
  "test-only-dummy-anon-ref-secret-not-used-anywhere-real";

// SEC-84: the one-click List-Unsubscribe link is an HMAC keyed by the server-only
// EMAIL_UNSUBSCRIBE_SECRET. The same kind of dummy, non-secret value (at least 32 characters), set
// unconditionally so a value in the developer's shell never changes what tests see.
process.env.EMAIL_UNSUBSCRIBE_SECRET =
  "test-only-dummy-email-unsubscribe-secret-not-used-anywhere-real";
