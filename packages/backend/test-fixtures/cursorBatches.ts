// The one-off backfills page their table in cursor batches (PERF-B16): each call handles one
// batch and returns `continueCursor` until `isDone`. This runs a backfill the way an operator
// would, feeding each cursor back in, and returns every batch's result.
export type CursorBatch = { isDone: boolean; continueCursor: string | null };

export const drainBatches = async <B extends CursorBatch>(
  runBatch: (cursor: string | null) => Promise<B>,
  maxBatches = 100,
): Promise<B[]> => {
  const batches: B[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxBatches; i++) {
    const batch = await runBatch(cursor);
    batches.push(batch);
    if (batch.isDone) return batches;
    cursor = batch.continueCursor;
  }
  throw new Error(`backfill not done after ${maxBatches} batches`);
};
