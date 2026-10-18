"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";

// Forwards an `events.dispatch` error wide event to Axiom. The dispatcher is a mutation, which
// cannot use the Node-only Axiom SDK, so it logs the line to the deployment log itself and
// schedules this action with the same line. Best-effort, never throws (see lib/axiom).
export const ingest = internalAction({
  args: { line: v.any() },
  handler: async (_ctx, { line }) => {
    await ingestToAxiom(line as Record<string, unknown>);
  },
});
