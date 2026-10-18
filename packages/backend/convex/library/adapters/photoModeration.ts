// Pluggable content-moderation port + adapters for uploaded copy and completion photos. Kept as a
// small, pure, dependency-free module (no Convex ctx, no "use node") so the decision logic is
// unit-testable with a fake `fetch`. The Node actions `library/moderatePhoto.ts` and
// `solving/moderateCompletionPhoto.ts` wire the real adapter in.
//
// NEVER SILENTLY APPROVE: a provider problem (missing token, auth failure, 5xx, network error,
// unexpected response) yields status "unscored" with a reason, never "approved". The pipelines keep
// an unscored photo visible to its uploader only, retry the transient cases with backoff, and log
// every outcome, so a misconfigured or unreachable classifier is visible instead of a silent pass.
//
// ENV (per Convex deployment):
//   MODERATION_PROVIDER       — "huggingface" (default) | "none" (explicitly disabled: approves
//                               without classifying, logged as outcome "disabled").
//   HF_MODERATION_TOKEN       — Hugging Face access token with the "Inference Providers"
//                               permission. Unset => every photo is "unscored" (missing_token).
//   HF_MODERATION_MODEL       — optional model id, default Falconsai/nsfw_image_detection. Must be
//                               served by the hf-inference provider and emit an "nsfw" label.
//   MODERATION_NSFW_THRESHOLD — float in [0,1], default 0.85. nsfw score >= threshold => rejected.

export const DEFAULT_NSFW_THRESHOLD = 0.85;

// Copy any Uint8Array into a fresh, plain ArrayBuffer so it satisfies strict BodyInit/BlobPart
// types (the source may be backed by a SharedArrayBuffer, which those types reject).
export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};

/** The model's per-label score, as returned by the image-classification inference API. */
export interface ModerationLabelScore {
  label: string;
  score: number;
}

/** Why a photo could not be scored. */
export type UnscoredReason =
  | "missing_token" // HF_MODERATION_TOKEN unset
  | "auth" // 401/403: token invalid or lacks the Inference Providers permission
  | "rate_limited" // 429
  | "model_unavailable" // 404: the provider does not (or no longer) serve the model
  | "provider_error" // 5xx (incl. 503 model loading) or another non-OK status
  | "network" // fetch threw (DNS, connection reset, timeout)
  | "bad_response" // 200 but no usable nsfw score in the body
  // Pipeline-side reasons (set by the moderation actions, not the adapter):
  | "missing_file" // the stored blob is gone
  | "download_error" // reading the blob threw
  | "internal_error"; // the classify step threw unexpectedly

/**
 * What happened, for logs and metrics: "scored" (the classifier produced an nsfw score), "unscored"
 * (it could not, see `reason`) or "disabled" (MODERATION_PROVIDER=none).
 */
export type ScreeningOutcome = "scored" | "unscored" | "disabled";

/**
 * The outcome of classifying one image. `status` is the decision; `score`/`label` are the decisive
 * nsfw signal (null when nothing was scored); `scores` is the full raw per-label output from the
 * model (empty when nothing was classified), surfaced for the wide log so an unexpected verdict is
 * debuggable. `retryable` says whether trying again later may help (rate limit, 5xx, network);
 * configuration problems (missing token, auth, unknown model) are not retryable.
 */
export interface ModerationResult {
  status: "approved" | "rejected" | "unscored";
  outcome: ScreeningOutcome;
  score: number | null;
  label: string | null;
  scores: readonly ModerationLabelScore[];
  reason: UnscoredReason | null;
  retryable: boolean;
  httpStatus: number | null;
}

/**
 * The moderation port. An adapter takes image bytes (plus their mime type, when known) and returns
 * a decision. Implementations must NEVER throw: a provider problem is reported as "unscored".
 */
export interface PhotoModerationPort {
  classify(bytes: Uint8Array, mime?: string): Promise<ModerationResult>;
}

/** The default Hugging Face image-classification model id (also logged for context). */
export const HF_MODEL = "Falconsai/nsfw_image_detection";

/**
 * The Hugging Face Inference Providers router endpoint for a model on the hf-inference provider.
 * The legacy serverless host (api-inference.huggingface.co) was retired and no longer resolves.
 * Request: POST the raw image bytes with `Authorization: Bearer <token>`; response: `[{label,score}]`.
 */
export const hfInferenceEndpoint = (model: string): string =>
  `https://router.huggingface.co/hf-inference/models/${model}`;

/** The configured model id (HF_MODERATION_MODEL), falling back to {@link HF_MODEL}. */
export const readModel = (raw: string | undefined): string => {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : HF_MODEL;
};

// Env values set via `convex env set KEY "value"` sometimes keep wrapping quotes or a trailing
// newline; both would turn a valid token into a 401.
export const sanitizeToken = (raw: string | undefined): string | undefined => {
  const cleaned = raw
    ?.trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  return cleaned ? cleaned : undefined;
};

/** Per-request timeout for the classifier call; a hung request becomes a retryable "network". */
export const HF_TIMEOUT_MS = 30_000;

/**
 * Backoff between classification attempts for a retryable unscored result: attempt 1 runs on
 * upload, then 1 min, 5 min and 30 min later. After the last attempt the photo stays "unscored".
 */
export const MODERATION_RETRY_DELAYS_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
];

/** The delay before attempt `attempt + 1`, or null when `attempt` was the last one. */
export const nextRetryDelayMs = (attempt: number): number | null =>
  MODERATION_RETRY_DELAYS_MS[attempt - 1] ?? null;

export const unscoredResult = (
  reason: UnscoredReason,
  retryable: boolean,
  httpStatus: number | null = null,
  scores: readonly ModerationLabelScore[] = [],
): ModerationResult => ({
  status: "unscored",
  outcome: "unscored",
  score: null,
  label: null,
  scores,
  reason,
  retryable,
  httpStatus,
});

/** Map a non-OK HTTP status to an unscored reason + whether a retry may help. */
export const classifyHttpFailure = (
  status: number,
): { reason: UnscoredReason; retryable: boolean } => {
  if (status === 401 || status === 403) {
    return { reason: "auth", retryable: false };
  }
  if (status === 404) return { reason: "model_unavailable", retryable: false };
  if (status === 429) return { reason: "rate_limited", retryable: true };
  if (status >= 500) return { reason: "provider_error", retryable: true };
  return { reason: "provider_error", retryable: false };
};

// Narrow the unknown JSON shape returned by HF. The model returns either a flat
// `[{label,score}, …]` array or, occasionally, a nested `[[{label,score}, …]]`. Be liberal.
const flattenScores = (raw: unknown): ModerationLabelScore[] => {
  if (!Array.isArray(raw)) return [];
  const flat = Array.isArray(raw[0])
    ? (raw[0] as unknown[])
    : (raw as unknown[]);
  const out: ModerationLabelScore[] = [];
  for (const item of flat) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { score?: unknown }).score === "number"
    ) {
      out.push({
        label: (item as ModerationLabelScore).label,
        score: (item as ModerationLabelScore).score,
      });
    }
  }
  return out;
};

/**
 * Turn a list of label scores into a decision. Pure and exhaustively unit-testable: pulls the
 * `nsfw` score (case-insensitive), compares to `threshold`, and returns the result. When no nsfw
 * label is present the photo is "unscored" (bad_response): a model that emits no nsfw score has
 * not checked anything, so it must not count as clean.
 */
export const decideFromScores = (
  scores: ModerationLabelScore[],
  threshold: number,
): ModerationResult => {
  const nsfw = scores.find((s) => s.label.toLowerCase() === "nsfw");
  if (!nsfw) return unscoredResult("bad_response", false, 200, scores);
  return {
    status: nsfw.score >= threshold ? "rejected" : "approved",
    outcome: "scored",
    score: nsfw.score,
    label: "nsfw",
    scores,
    reason: null,
    retryable: false,
    httpStatus: 200,
  };
};

/** Options for the Hugging Face adapter; injected so tests can supply a fake fetch + env. */
export interface HuggingFaceModerationOptions {
  token: string | undefined;
  threshold: number;
  model?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn" | "error">;
}

/**
 * The default adapter: POSTs the image bytes to the HF Inference Providers router and decides from
 * the response. Any failure (missing token, non-OK response, thrown error, unusable body) is
 * reported as "unscored" with a reason and logged; it never approves on error and never throws.
 */
export const makeHuggingFaceModerationPort = (
  opts: HuggingFaceModerationOptions,
): PhotoModerationPort => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.logger ?? console;
  const endpoint = hfInferenceEndpoint(opts.model ?? HF_MODEL);
  return {
    async classify(
      bytes: Uint8Array,
      mime?: string,
    ): Promise<ModerationResult> {
      if (!opts.token) {
        log.warn(
          "[moderation] HF_MODERATION_TOKEN unset; photo left unscored (set the token to enable screening).",
        );
        return unscoredResult("missing_token", false);
      }
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.token}`,
            "Content-Type": mime ?? "application/octet-stream",
          },
          // Wrap in a Blob so the body is a well-typed BodyInit regardless of the Uint8Array's
          // backing buffer type (SharedArrayBuffer vs ArrayBuffer under strict lib types).
          body: new Blob([toArrayBuffer(bytes)]),
          signal: AbortSignal.timeout(HF_TIMEOUT_MS),
        });
      } catch (error) {
        log.error(
          "[moderation] HF inference request failed; photo left unscored.",
          error instanceof Error ? error.message : String(error),
        );
        return unscoredResult("network", true);
      }
      if (!response.ok) {
        const { reason, retryable } = classifyHttpFailure(response.status);
        log.error(
          `[moderation] HF inference returned ${response.status} (${reason}); photo left unscored. ${await response
            .text()
            .catch(() => "")}`,
        );
        return unscoredResult(reason, retryable, response.status);
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        log.error(
          "[moderation] HF inference returned a non-JSON body; photo left unscored.",
          error instanceof Error ? error.message : String(error),
        );
        return unscoredResult("bad_response", false, response.status);
      }
      return decideFromScores(flattenScores(raw), opts.threshold);
    },
  };
};

/**
 * The "none" provider: approves without classifying. An explicit operator opt-out, reported as
 * outcome "disabled" (and flagged by the admin screening-health check), never a silent pass.
 */
export const makeNoopModerationPort = (): PhotoModerationPort => ({
  async classify(): Promise<ModerationResult> {
    return {
      status: "approved",
      outcome: "disabled",
      score: null,
      label: null,
      scores: [],
      reason: null,
      retryable: false,
      httpStatus: null,
    };
  },
});

/** Read MODERATION_NSFW_THRESHOLD as a float in [0,1], falling back to the default if unparseable. */
export const readThreshold = (raw: string | undefined): number => {
  if (raw == null) return DEFAULT_NSFW_THRESHOLD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_NSFW_THRESHOLD;
  }
  return parsed;
};

/** The moderation env knobs, as read from `process.env`. */
export interface ModerationEnv {
  MODERATION_PROVIDER?: string;
  HF_MODERATION_TOKEN?: string;
  HF_MODERATION_MODEL?: string;
  MODERATION_NSFW_THRESHOLD?: string;
}

/** The normalised provider name: "none" disables screening; anything else means Hugging Face. */
export const readProvider = (
  raw: string | undefined,
): "huggingface" | "none" =>
  (raw ?? "huggingface").trim().toLowerCase() === "none"
    ? "none"
    : "huggingface";

/**
 * Select + build the configured moderation port from environment values. Defaults to the Hugging
 * Face adapter; "none" disables moderation. Unknown providers fall back to huggingface, so a typo
 * never silently disables screening.
 */
export const makeModerationPortFromEnv = (
  env: ModerationEnv,
  deps?: { fetchImpl?: typeof fetch; logger?: Pick<Console, "warn" | "error"> },
): PhotoModerationPort => {
  if (readProvider(env.MODERATION_PROVIDER) === "none") {
    return makeNoopModerationPort();
  }
  return makeHuggingFaceModerationPort({
    token: sanitizeToken(env.HF_MODERATION_TOKEN),
    threshold: readThreshold(env.MODERATION_NSFW_THRESHOLD),
    model: readModel(env.HF_MODERATION_MODEL),
    fetchImpl: deps?.fetchImpl,
    logger: deps?.logger,
  });
};

/**
 * Configuration health of photo screening, derived from env only (no secret values): whether the
 * provider is enabled and a token is present. Used by the admin indicator and the post-deploy probe.
 */
export interface ScreeningConfig {
  provider: "huggingface" | "none";
  tokenConfigured: boolean;
  model: string;
  endpoint: string;
  threshold: number;
  /** "ok" | "disabled" (provider none) | "missing_token". Reachability is not checked here. */
  status: "ok" | "disabled" | "missing_token";
}

export const readScreeningConfig = (env: ModerationEnv): ScreeningConfig => {
  const provider = readProvider(env.MODERATION_PROVIDER);
  const tokenConfigured = sanitizeToken(env.HF_MODERATION_TOKEN) !== undefined;
  const model = readModel(env.HF_MODERATION_MODEL);
  return {
    provider,
    tokenConfigured,
    model,
    endpoint: hfInferenceEndpoint(model),
    threshold: readThreshold(env.MODERATION_NSFW_THRESHOLD),
    status:
      provider === "none"
        ? "disabled"
        : tokenConfigured
          ? "ok"
          : "missing_token",
  };
};

/**
 * A row the re-screen should (re)classify: "unscored", or approved (absent = legacy approved)
 * WITHOUT a classifier score — i.e. never actually checked (legacy, provider "none", or the old
 * fail-open pipeline). Pending rows belong to the live pipeline; rejected and scored rows are
 * decided.
 */
export const needsRescreen = (row: {
  moderationStatus?: string;
  moderationScore?: number;
}): boolean => {
  const status = row.moderationStatus ?? "approved";
  if (status === "unscored") return true;
  return status === "approved" && row.moderationScore === undefined;
};

/**
 * What the pipeline does with a classification result on attempt `attempt` (1-based): write the
 * verdict, or — for a retryable unscored result with attempts left — schedule another attempt.
 */
export type ModerationStep =
  | { kind: "verdict"; result: ModerationResult }
  | { kind: "retry"; delayMs: number };

export const planModerationStep = (
  result: ModerationResult,
  attempt: number,
): ModerationStep => {
  if (result.status === "unscored" && result.retryable) {
    const delayMs = nextRetryDelayMs(attempt);
    if (delayMs !== null) return { kind: "retry", delayMs };
  }
  return { kind: "verdict", result };
};

/** The wide-event fields describing one classification result (no secrets, no image data). */
export const screeningLogFields = (
  result: ModerationResult,
): Record<string, unknown> => ({
  screening_outcome: result.outcome,
  unscored_reason: result.reason,
  retryable: result.retryable,
  http_status: result.httpStatus,
  nsfw_score: result.score,
  nsfw_label: result.label,
  // The raw per-label classifier output (e.g. [{label:"nsfw",score},{label:"normal",score}]) so
  // an unexpected verdict is debuggable straight from the log line.
  classifier_scores: result.scores,
});
