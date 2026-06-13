"use node";
// Forwards wide events to Axiom (https://axiom.co) from Node actions, since this project is not on
// Convex Pro (which would otherwise stream logs natively). Best-effort: a no-op until AXIOM_API_KEY
// is configured, and never throws — observability must never break the request it is observing.
//
// We POST directly to Axiom's regional EDGE ingest endpoint rather than via @axiomhq/js, because:
//   1. the SDK's AxiomWithoutBatching re-throws / obscures ingest errors (a 403 surfaced as an
//      opaque uncaught "forbidden"), making misconfiguration invisible; a direct call logs the
//      exact HTTP status + body.
//   2. the edge ingest path is `/v1/ingest/{dataset}` (NOT the legacy `/v1/datasets/{dataset}/
//      ingest`), and the dataset lives in eu-central-1 of the unified platform.
//
// Requirements: an `xaat-*` API token (personal `xapt-*` tokens are rejected by the edge) with
// INGEST permission on the dataset. The token is trimmed to defend against stray whitespace/newlines
// introduced when setting the Convex env var.
//
// Env (per Convex deployment): AXIOM_API_KEY (required), AXIOM_DATASET (default "jigswap"),
//   AXIOM_EDGE (default "eu-central-1.aws.edge.axiom.co", scheme optional).

export const ingestToAxiom = async (
  line: Record<string, unknown>,
): Promise<void> => {
  const token = process.env.AXIOM_API_KEY?.trim();
  if (!token) return;

  const edge = (process.env.AXIOM_EDGE ?? "eu-central-1.aws.edge.axiom.co")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const dataset = process.env.AXIOM_DATASET ?? "jigswap";
  const endpoint = `https://${edge}/v1/ingest/${encodeURIComponent(dataset)}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Axiom uses `_time` for the event timestamp; falls back to ingest time if absent.
      body: JSON.stringify([{ _time: line.timestamp, ...line }]),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `axiom ingest failed: HTTP ${res.status} ${res.statusText} @ ${endpoint} — ${body.slice(0, 300)}`,
      );
    }
  } catch (error) {
    console.error(
      "axiom ingest error:",
      error instanceof Error ? error.message : String(error),
    );
  }
};
