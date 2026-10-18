// CSAM hash matching for uploaded images: a port plus adapters, run by the shared moderation
// pipeline BEFORE classification (lib/imageModeration/pipeline.ts). Pure and dependency-free (no
// Convex ctx, no "use node"): the pipeline computes the hashes with node:crypto and passes them
// in, so the adapters are unit-tested with a fake `fetch`.
//
// What it is NOT: the NSFW classifier is not a CSAM control and must never be described as one.
// Hash matching only recognises known material from a list (here the Offlimits / EOKM
// HashCheckService, free for European hosts); it says nothing about unknown images.
//
// Only hashes ever leave the platform, never image bytes. Credentials and hashes are never logged:
// the pipeline logs the outcome (match / no_match / unavailable) and a reason code only.
//
// ENV (per Convex deployment, `npx convex env set`; documented in packages/backend/.env.example):
//   CSAM_HASHCHECK_PROVIDER — "offlimits" | "none" (default). Anything else means "none".
//   OFFLIMITS_HCS_BASE_URL  — the HashCheckService endpoint (https only).
//   OFFLIMITS_HCS_USERNAME  — HCS user id.
//   OFFLIMITS_HCS_PASSWORD  — HCS password.
// "offlimits" with any of the three missing behaves as "none" (inert), which the pipeline logs as
// `csam_hashcheck_config: "missing_config"` and the admin escalations view reports by var NAME.
//
// Fixed-IP egress: HCS allow-lists caller IPs, and Convex has no fixed egress IP. A proxy
// (OFFLIMITS_HCS_PROXY_URL) is NOT implemented: Node's built-in fetch only takes a proxy through
// undici's ProxyAgent `dispatcher`, and undici is not importable without adding it as a
// dependency. See .env.example.

export type CsamHashCheckProvider = "offlimits" | "none";

/** The hashes of one image: lowercase hex MD5 and SHA-1, which is what HCS matches on. */
export interface ImageHashes {
  md5: string;
  sha1: string;
}

/**
 * The outcome of one check. "unavailable" means the service could not answer (not configured
 * correctly, network, non-2xx, unreadable body); the pipeline then continues to classification,
 * so hash-check availability never holds up uploads. `reason` is a short code for the log.
 */
export interface CsamHashCheckResult {
  status: "match" | "no_match" | "unavailable";
  reason?: string;
}

/** The port. Implementations must NEVER throw. */
export interface CsamHashCheckPort {
  readonly provider: CsamHashCheckProvider;
  check(hashes: ImageHashes): Promise<CsamHashCheckResult>;
}

/** Per-request timeout; a hung request becomes "unavailable". */
export const OFFLIMITS_HCS_TIMEOUT_MS = 10_000;

/** The "none" adapter: always no_match. The default when nothing is configured. */
export const makeNoopCsamHashCheckPort = (): CsamHashCheckPort => ({
  provider: "none",
  async check() {
    return { status: "no_match" };
  },
});

/**
 * PROVISIONAL: align with the HCS API manual once access is granted. The manual is not public;
 * known facts are an HTTP API, user id + password auth, IP allow-listing, and MD5 + SHA-1 hashes
 * (only hashes are sent). This is the ONE place that encodes the wire format:
 *   - request:  JSON `{ "md5": "<hex>", "sha1": "<hex>" }`, POSTed with basic auth;
 *   - response: JSON with a boolean `match` (true = the hash is on the list).
 * A body that does not fit returns null, which the adapter treats as "unavailable" (never as a
 * match or a pass), so a format mismatch is visible in the logs instead of silently clean.
 */
export const offlimitsHcsWireFormat = {
  requestBody: (hashes: ImageHashes): string =>
    JSON.stringify({ md5: hashes.md5, sha1: hashes.sha1 }),
  parseResponse: (body: unknown): "match" | "no_match" | null => {
    if (!body || typeof body !== "object") return null;
    const match = (body as { match?: unknown }).match;
    if (typeof match !== "boolean") return null;
    return match ? "match" : "no_match";
  },
};

export interface OfflimitsHcsOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}

/**
 * The Offlimits / EOKM HashCheckService adapter: an HTTPS POST to OFFLIMITS_HCS_BASE_URL with
 * basic auth and a JSON body of the hashes. Any non-2xx response, network error, timeout or
 * unreadable body is "unavailable". Never throws, never logs.
 */
export const makeOfflimitsCsamHashCheckPort = (
  opts: OfflimitsHcsOptions,
): CsamHashCheckPort => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    provider: "offlimits",
    async check(hashes) {
      // Basic auth only ever travels over TLS.
      if (!opts.baseUrl.toLowerCase().startsWith("https://")) {
        return { status: "unavailable", reason: "insecure_url" };
      }
      let response: Response;
      try {
        response = await fetchImpl(opts.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${opts.username}:${opts.password}`)}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: offlimitsHcsWireFormat.requestBody(hashes),
          signal: AbortSignal.timeout(OFFLIMITS_HCS_TIMEOUT_MS),
        });
      } catch {
        return { status: "unavailable", reason: "network" };
      }
      if (!response.ok) {
        return { status: "unavailable", reason: `http_${response.status}` };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { status: "unavailable", reason: "bad_response" };
      }
      const status = offlimitsHcsWireFormat.parseResponse(body);
      if (status === null) {
        return { status: "unavailable", reason: "bad_response" };
      }
      return { status };
    },
  };
};

/** The hash-check env knobs, as read from `process.env`. */
export interface CsamHashCheckEnv {
  CSAM_HASHCHECK_PROVIDER?: string;
  OFFLIMITS_HCS_BASE_URL?: string;
  OFFLIMITS_HCS_USERNAME?: string;
  OFFLIMITS_HCS_PASSWORD?: string;
}

const OFFLIMITS_REQUIRED = [
  "OFFLIMITS_HCS_BASE_URL",
  "OFFLIMITS_HCS_USERNAME",
  "OFFLIMITS_HCS_PASSWORD",
] as const;

// Env values set via `convex env set` sometimes keep wrapping quotes or a trailing newline.
const clean = (raw: string | undefined): string | undefined => {
  const value = raw
    ?.trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  return value ? value : undefined;
};

/**
 * Configuration health from env only (never values): the selected provider, whether it is
 * active, and the NAMES of missing vars. "disabled" = provider none; "missing_config" =
 * offlimits selected but not fully configured (inert, behaves as none).
 */
export interface CsamHashCheckConfig {
  provider: CsamHashCheckProvider;
  status: "ok" | "disabled" | "missing_config";
  missingVars: string[];
}

export const readCsamHashCheckConfig = (
  env: CsamHashCheckEnv,
): CsamHashCheckConfig => {
  const selected = clean(env.CSAM_HASHCHECK_PROVIDER)?.toLowerCase();
  if (selected !== "offlimits") {
    return { provider: "none", status: "disabled", missingVars: [] };
  }
  const missingVars = OFFLIMITS_REQUIRED.filter(
    (name) => clean(env[name]) === undefined,
  );
  return {
    provider: "offlimits",
    status: missingVars.length === 0 ? "ok" : "missing_config",
    missingVars,
  };
};

/** Build the configured port. Unconfigured or incomplete config => the "none" adapter. */
export const makeCsamHashCheckPortFromEnv = (
  env: CsamHashCheckEnv,
  deps?: { fetchImpl?: typeof fetch },
): CsamHashCheckPort => {
  const config = readCsamHashCheckConfig(env);
  if (config.status !== "ok") return makeNoopCsamHashCheckPort();
  return makeOfflimitsCsamHashCheckPort({
    baseUrl: clean(env.OFFLIMITS_HCS_BASE_URL)!,
    username: clean(env.OFFLIMITS_HCS_USERNAME)!,
    password: clean(env.OFFLIMITS_HCS_PASSWORD)!,
    fetchImpl: deps?.fetchImpl,
  });
};

/**
 * Check every hash pair (the original upload, then its re-encode when there is one) and return
 * the first match, else "unavailable" if any check could not answer, else "no_match". A match on
 * any variant wins; never throws.
 */
export const checkAllHashes = async (
  port: CsamHashCheckPort,
  variants: readonly ImageHashes[],
): Promise<CsamHashCheckResult & { matched?: ImageHashes }> => {
  let unavailable: CsamHashCheckResult | null = null;
  for (const hashes of variants) {
    let result: CsamHashCheckResult;
    try {
      result = await port.check(hashes);
    } catch {
      result = { status: "unavailable", reason: "internal_error" };
    }
    if (result.status === "match") return { ...result, matched: hashes };
    if (result.status === "unavailable") unavailable ??= result;
  }
  return unavailable ?? { status: "no_match" };
};
