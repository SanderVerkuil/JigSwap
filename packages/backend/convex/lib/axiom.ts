"use node";
import { AxiomWithoutBatching } from "@axiomhq/js";

// Forwards wide events to Axiom (https://axiom.co) from Node actions, since this project is not on
// Convex Pro (which would otherwise stream logs natively). Best-effort: a no-op until AXIOM_API_KEY
// is configured in the Convex deployment, and never throws — observability must never break the
// request it is observing.
//
// We use AxiomWithoutBatching so each action invocation ingests exactly one event and awaits the
// HTTP call (no background batch to flush before the serverless function exits).
//
// Env (set per Convex deployment with `npx convex env set ...`):
//   AXIOM_API_KEY  (required to enable) — an Axiom API token with INGEST permission on the dataset,
//                  created in the SAME region/org as the dataset (else Axiom returns 403 Forbidden)
//   AXIOM_DATASET  (default "jigswap")
//   AXIOM_URL      (default "https://api.eu.axiom.co") — the org/dataset is EU-region. Without an
//                  `edge` option, the SDK uses `url` for ingest as well.

let client: AxiomWithoutBatching | null = null;
let resolved = false;

const getClient = (): AxiomWithoutBatching | null => {
  if (resolved) return client;
  resolved = true;
  const token = process.env.AXIOM_API_KEY;
  if (token) {
    client = new AxiomWithoutBatching({
      token,
      // Strip any trailing slash so the SDK doesn't build a `//v1/...` path.
      url: (process.env.AXIOM_URL ?? "https://api.eu.axiom.co").replace(
        /\/+$/,
        "",
      ),
    });
  }
  return client;
};

export const ingestToAxiom = async (
  line: Record<string, unknown>,
): Promise<void> => {
  const axiom = getClient();
  if (!axiom) return;
  const dataset = process.env.AXIOM_DATASET ?? "jigswap";
  try {
    // Axiom uses `_time` for the event timestamp; falls back to ingest time if absent.
    await axiom.ingest(dataset, [{ _time: line.timestamp, ...line }]);
  } catch (error) {
    console.error(
      "axiom ingest failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
};
