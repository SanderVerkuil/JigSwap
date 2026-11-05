import { logEvent } from "./logEvent";

// The daily retention backstops (crons.ts): paged sweeps that find data past the retention the
// privacy policy states and delete or anonymise it. Each sweep is DRY-RUN unless the deployment's
// RETENTION_ENFORCE environment variable names it ("all", or a comma-separated list of sweep
// names): a dry run reads and counts what is due and logs it, and changes nothing. Switching a
// sweep on is the operator's decision, taken after reading the dry-run counts.
//
// Every page of every sweep emits one `retention.sweep` wide event: the sweep, how many rows in
// the page were due, how many it acted on (always 0 in a dry run) and whether it was a dry run.

/** The sweeps RETENTION_ENFORCE can name. */
export type RetentionSweep =
  "reports" | "sentPhotos" | "copyPhotos" | "domainEvents";

/** Rows a sweep reads per run; it re-schedules itself for the next page. */
export const RETENTION_SWEEP_PAGE = 100;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether `sweep` may change data: RETENTION_ENFORCE is "all" or lists it. */
export const retentionEnforced = (
  sweep: RetentionSweep,
  enforce: string | undefined = process.env.RETENTION_ENFORCE,
): boolean => {
  const names = (enforce ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.includes("all") || names.includes(sweep);
};

/** The one wide event per sweep page. `outcome` "error" makes it alertable. */
export const logRetentionSweep = (
  fields: {
    sweep: RetentionSweep;
    due: number;
    acted: number;
    dryRun: boolean;
    isDone: boolean;
    outcome?: "success" | "error";
  } & Record<string, unknown>,
): void => {
  const { sweep, due, acted, dryRun, isDone, outcome, ...rest } = fields;
  logEvent({
    event: "retention.sweep",
    outcome: outcome ?? "success",
    sweep,
    due,
    acted,
    dry_run: dryRun,
    is_done: isDone,
    ...rest,
  });
};
