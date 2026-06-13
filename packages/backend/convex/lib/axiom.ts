"use node";
import { AxiomWithoutBatching } from "@axiomhq/js";

// Forwards wide events to Axiom (https://axiom.co) from Node actions, since this project is not on
// Convex Pro (which would otherwise stream logs natively). Best-effort: a no-op until the
// AXIOM_API_KEY env var is configured in the Convex deployment, and never throws — observability
// must never break the request it is observing.
//
// Env (set per Convex deployment with `npx convex env set ...`):
//   AXIOM_API_KEY  (required to enable)  — an Axiom "Advanced API token" with Ingest on the dataset
//   AXIOM_DATASET  (default "jigswap")
//   AXIOM_URL      (default EU endpoint) — the org is EU-region, so this must be api.eu.axiom.co
//
// We use AxiomWithoutBatching: each action invocation ingests exactly one event and awaits the
// HTTP call, so there is no background batch to flush before the serverless function exits.

let client: AxiomWithoutBatching | null = null;
let resolved = false;

const getClient = (): AxiomWithoutBatching | null => {
  if (resolved) return client;
  resolved = true;
  const token = process.env.AXIOM_API_KEY;
  if (token) {
    client = new AxiomWithoutBatching({
      token,
      url: process.env.AXIOM_URL ?? "https://api.eu.axiom.co",
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
    // Axiom uses `_time` for the event timestamp; fall back to ingest time if our line lacks one.
    await axiom.ingest(dataset, [{ _time: line.timestamp, ...line }]);
  } catch (error) {
    console.error("axiom ingest failed:", error);
  }
};
