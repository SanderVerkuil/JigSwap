"use node";
import { AxiomWithoutBatching } from "@axiomhq/js";

// Forwards wide events to Axiom (https://axiom.co) from Node actions, since this project is not on
// Convex Pro (which would otherwise stream logs natively). Best-effort: a no-op until AXIOM_API_KEY
// is configured, and never throws — observability must never break the request it is observing.
//
// REGION: the `jigswap` dataset is in the eu-central-1 region of Axiom's unified platform, so ingest
// must go through that region's EDGE (the SDK's `edge` option → https://<edge>/v1/ingest/<dataset>).
// `api.eu.axiom.co` is Axiom's separate legacy EU cloud and rejects unified-platform tokens.
//
// TOKEN: edge ingest requires an API token (`xaat-*`) with INGEST permission. Personal access tokens
// (`xapt-*`) are rejected. We sanitize the env value because the two common ways it gets mangled
// when set as a Convex env var are wrapping quotes (`convex env set KEY "xaat-..."`) and a trailing
// newline — both produce a 403 even when the raw token is valid.
//
// Env (per Convex deployment): AXIOM_API_KEY (required), AXIOM_DATASET (default "jigswap"),
//   AXIOM_EDGE (default "eu-central-1.aws.edge.axiom.co").

let client: AxiomWithoutBatching | null = null;
let resolved = false;

const sanitizeToken = (raw: string): string =>
  raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

const getClient = (): AxiomWithoutBatching | null => {
  if (resolved) return client;
  resolved = true;
  const raw = process.env.AXIOM_API_KEY;
  if (raw) {
    client = new AxiomWithoutBatching({
      token: sanitizeToken(raw),
      edge: (process.env.AXIOM_EDGE ?? "eu-central-1.aws.edge.axiom.co").trim(),
      // Log ingest failures instead of letting the SDK's default handler re-throw them opaquely.
      onError: (error) =>
        console.error(
          "axiom ingest failed:",
          error instanceof Error ? error.message : String(error),
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
    const status = await axiom.ingest(dataset, [
      { _time: line.timestamp, ...line },
    ]);
    if (status.ingested === 0) {
      // onError above already logged the cause; this confirms nothing landed.
      console.error(`axiom ingest: 0 events ingested into "${dataset}"`);
    }
  } catch (error) {
    console.error(
      "axiom ingest error:",
      error instanceof Error ? error.message : String(error),
    );
  }
};
