"use node";
import { AxiomWithoutBatching } from "@axiomhq/js";

// Forwards wide events to Axiom (https://axiom.co) from Node actions, since this project is not on
// Convex Pro (which would otherwise stream logs natively). Best-effort: a no-op until AXIOM_API_KEY
// is configured in the Convex deployment, and never throws — observability must never break the
// request it is observing.
//
// REGION: the `jigswap` dataset lives in the eu-central-1 region of Axiom's unified platform, so
// ingest must go through that region's EDGE endpoint via the SDK's `edge` option — NOT
// `api.eu.axiom.co`, which is Axiom's separate legacy EU cloud and rejects unified-platform tokens.
//
// TOKEN: edge ingest REQUIRES an API token (`xaat-*`) with ingest permission. Personal access
// tokens (`xapt-*`) are rejected by the edge.
//
// Env (set per Convex deployment with `npx convex env set ...`):
//   AXIOM_API_KEY  (required to enable) — an `xaat-*` API token with INGEST on the dataset
//   AXIOM_DATASET  (default "jigswap")
//   AXIOM_EDGE     (default "eu-central-1.aws.edge.axiom.co") — regional edge domain, no scheme

let client: AxiomWithoutBatching | null = null;
let resolved = false;

const getClient = (): AxiomWithoutBatching | null => {
  if (resolved) return client;
  resolved = true;
  const token = process.env.AXIOM_API_KEY;
  if (token) {
    client = new AxiomWithoutBatching({
      token,
      // Routes ingest/query to the dataset's region. The scheme is added by the SDK.
      edge: process.env.AXIOM_EDGE ?? "eu-central-1.aws.edge.axiom.co",
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
