// Single structured logger for Convex functions. Emit exactly ONE wide event per request (a
// canonical log line) at the boundary — build the object up through the handler and flush it in a
// `finally`. Convex captures console.log into deployment logs, where these JSON lines are queryable.
//
// Principles (see logging-best-practices): high dimensionality (many fields), high cardinality
// (user/request ids), business + environment context on every event, two levels only (info/error).

// Environment characteristics, attached to every event so issues can be correlated with a
// deployment/region. CONVEX_CLOUD_URL is provided by the Convex runtime; GIT_COMMIT/SERVICE_VERSION
// are optional (set via `npx convex env set GIT_COMMIT <sha>` if you want deploy correlation).
const environment = {
  service: "jigswap-backend",
  deployment: process.env.CONVEX_CLOUD_URL,
  commit: process.env.GIT_COMMIT,
  version: process.env.SERVICE_VERSION,
};

export interface WideEvent {
  /** Stable event name, e.g. "catalog.extractFromUrl". */
  event: string;
  /** "success" | "error" — the two levels we care about. */
  outcome: "success" | "error";
  /** Arbitrary high-dimensionality context (user, inputs, derived facts, error, timings). */
  [field: string]: unknown;
}

// Emits the wide event to the Convex deployment logs (console) and returns the enriched line so
// callers in a Node action can also forward it to an external sink (e.g. Axiom) — see lib/axiom.
export const logEvent = (fields: WideEvent): Record<string, unknown> => {
  const line = {
    timestamp: new Date().toISOString(),
    ...environment,
    ...fields,
  };
  // Convex tags console.log with the function path automatically; the JSON payload is the wide event.
  if (fields.outcome === "error") {
    console.error(JSON.stringify(line));
  } else {
    console.log(JSON.stringify(line));
  }
  return line;
};
