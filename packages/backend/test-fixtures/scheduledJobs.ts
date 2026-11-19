// How far convex-test can pin a transaction's clock past the wall clock: it never pins before the
// last commit, so a runAfter(0) job can look a few milliseconds from being due.
const PINNED_CLOCK_LEAD_MS = 100;

// A scheduled function that is running or due, as opposed to one delayed on purpose.
export const isRunningOrDue = (job: {
  state: { kind: string };
  scheduledTime: number;
}) =>
  job.state.kind === "inProgress" ||
  (job.state.kind === "pending" &&
    job.scheduledTime <= Date.now() + PINNED_CLOCK_LEAD_MS);
