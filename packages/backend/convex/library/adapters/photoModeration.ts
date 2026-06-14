// Pluggable content-moderation port + adapters for uploaded copy photos. Kept as a small, pure,
// dependency-free module (no Convex ctx, no "use node") so the decision logic is unit-testable with
// a fake `fetch`. The Node action `library/moderatePhoto.ts` wires the real adapter in.
//
// ENV (per Convex deployment):
//   MODERATION_PROVIDER       — "huggingface" (default) | "none" (always approve).
//   HF_MODERATION_TOKEN       — Hugging Face Inference API token (free tier). When UNSET the
//                               huggingface adapter fails OPEN: it logs a warning and approves with
//                               a null score, so the feature ships disabled-by-default and the
//                               operator opts in by setting the token.
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

/**
 * The outcome of classifying one image. `status` is the decision; `score`/`label` are the decisive
 * nsfw signal (null when the provider produced no score — e.g. "none" or a missing token).
 */
export interface ModerationResult {
  status: "approved" | "rejected";
  score: number | null;
  label: string | null;
}

/**
 * The moderation port. An adapter takes raw image bytes and returns a decision. Implementations must
 * NEVER throw for a benign/transient failure — they fail open (approve) and log, so a flaky provider
 * never hides a benign photo. Only a clearly-NSFW classification rejects.
 */
export interface PhotoModerationPort {
  classify(bytes: Uint8Array): Promise<ModerationResult>;
}

const HF_ENDPOINT =
  "https://api-inference.huggingface.co/models/Falconsai/nsfw_image_detection";

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
 * label is present it approves with a null score (the model didn't flag anything).
 */
export const decideFromScores = (
  scores: ModerationLabelScore[],
  threshold: number,
): ModerationResult => {
  const nsfw = scores.find((s) => s.label.toLowerCase() === "nsfw");
  if (!nsfw) {
    return { status: "approved", score: null, label: null };
  }
  return {
    status: nsfw.score >= threshold ? "rejected" : "approved",
    score: nsfw.score,
    label: "nsfw",
  };
};

/** Options for the Hugging Face adapter; injected so tests can supply a fake fetch + env. */
export interface HuggingFaceModerationOptions {
  token: string | undefined;
  threshold: number;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn" | "error">;
}

/**
 * The default adapter: POSTs the image bytes to the HF Inference API and decides from the response.
 * Fails OPEN (approve, null score) on a missing token, a non-OK response, or any thrown error —
 * always logging — so uploads are never blocked by provider problems. Only a confident nsfw score
 * rejects.
 */
export const makeHuggingFaceModerationPort = (
  opts: HuggingFaceModerationOptions,
): PhotoModerationPort => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.logger ?? console;
  return {
    async classify(bytes: Uint8Array): Promise<ModerationResult> {
      if (!opts.token) {
        log.warn(
          "[moderation] HF_MODERATION_TOKEN unset; approving photo without classification (set the token to enable moderation).",
        );
        return { status: "approved", score: null, label: null };
      }
      try {
        const response = await fetchImpl(HF_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.token}`,
            "Content-Type": "application/octet-stream",
          },
          // Wrap in a Blob so the body is a well-typed BodyInit regardless of the Uint8Array's
          // backing buffer type (SharedArrayBuffer vs ArrayBuffer under strict lib types).
          body: new Blob([toArrayBuffer(bytes)]),
        });
        if (!response.ok) {
          log.error(
            `[moderation] HF inference returned ${response.status}; failing open (approve). ${await response
              .text()
              .catch(() => "")}`,
          );
          return { status: "approved", score: null, label: null };
        }
        const raw: unknown = await response.json();
        return decideFromScores(flattenScores(raw), opts.threshold);
      } catch (error) {
        log.error(
          "[moderation] HF inference threw; failing open (approve).",
          error instanceof Error ? error.message : String(error),
        );
        return { status: "approved", score: null, label: null };
      }
    },
  };
};

/** The "none" provider: always approves, no classification. Lets an operator disable moderation. */
export const makeNoopModerationPort = (): PhotoModerationPort => ({
  async classify(): Promise<ModerationResult> {
    return { status: "approved", score: null, label: null };
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

/**
 * Select + build the configured moderation port from environment values. Defaults to the Hugging
 * Face adapter; "none" disables moderation. Unknown providers fall back to huggingface (which itself
 * fails open when unconfigured), so a typo never blocks uploads.
 */
export const makeModerationPortFromEnv = (
  env: {
    MODERATION_PROVIDER?: string;
    HF_MODERATION_TOKEN?: string;
    MODERATION_NSFW_THRESHOLD?: string;
  },
  deps?: { fetchImpl?: typeof fetch; logger?: Pick<Console, "warn" | "error"> },
): PhotoModerationPort => {
  const provider = (env.MODERATION_PROVIDER ?? "huggingface").toLowerCase();
  if (provider === "none") return makeNoopModerationPort();
  return makeHuggingFaceModerationPort({
    token: env.HF_MODERATION_TOKEN,
    threshold: readThreshold(env.MODERATION_NSFW_THRESHOLD),
    fetchImpl: deps?.fetchImpl,
    logger: deps?.logger,
  });
};
