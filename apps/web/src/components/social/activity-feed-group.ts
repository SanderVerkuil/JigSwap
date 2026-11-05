import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";

type ActivityEntry = FunctionReturnType<
  typeof gateway.social.activityFeed
>[number];

// As many covers as a server-grouped batch shows (getActivityFeed's BATCH_COVER_COUNT).
const COVER_COUNT = 4;

/**
 * Folds runs of consecutive single adds ("acquisition") by the same member on the same calendar
 * day into one batch-style row ("added N puzzles to their shelf"), so a member who adds puzzles one
 * at a time doesn't fill the feed with near-identical rows. The day is taken in `timeZone` (the
 * app's i18n time zone), so the server render and the client agree. Everything in the folded row
 * comes from the folded entries: covers from their `subject` (an unnamed add gets the
 * placeholder), and, as for a server batch, a link to the member's profile puzzles only when the
 * entry carries the server's actor link. Every add on its own already passed the profile gate
 * that page applies. Lone adds, batches and other kinds pass through unchanged, in order.
 */
export function groupSameDayAdds(
  entries: readonly ActivityEntry[],
  timeZone: string | undefined,
): ActivityEntry[] {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out: ActivityEntry[] = [];
  let run: ActivityEntry[] = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]!);
    else if (run.length > 1) out.push(foldAdds(run));
    run = [];
  };
  for (const entry of entries) {
    const last = run.at(-1);
    const joinsRun =
      last !== undefined &&
      entry.kind === "acquisition" &&
      entry.memberId === last.memberId &&
      day.format(entry.occurredAt) === day.format(last.occurredAt);
    if (joinsRun) {
      run.push(entry);
      continue;
    }
    flush();
    if (entry.kind === "acquisition") run = [entry];
    else out.push(entry);
  }
  flush();
  return out;
}

// One row for a run of adds, newest first like the feed: it takes the newest add's time.
const foldAdds = (run: ActivityEntry[]): ActivityEntry => {
  const newest = run[0]!;
  return {
    memberId: newest.memberId,
    kind: "acquisitionBatch",
    occurredAt: newest.occurredAt,
    ref: `day:${newest.ref}`,
    ...(newest.actorName !== undefined ? { actorName: newest.actorName } : {}),
    ...(newest.actorDeparted ? { actorDeparted: true as const } : {}),
    ...(newest.actor
      ? {
          actor: newest.actor,
          target: { kind: "memberPuzzles", handle: newest.actor.handle },
        }
      : {}),
    batch: {
      count: run.length,
      covers: run.slice(0, COVER_COUNT).map((entry) => ({
        copyId: entry.ref,
        title: entry.subject?.title ?? "",
        coverUrl: entry.subject?.coverUrl ?? null,
      })),
    },
  };
};
