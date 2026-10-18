import { describe, expect, test, vi } from "vitest";
import {
  classifyHttpFailure,
  decideFromScores,
  DEFAULT_NSFW_THRESHOLD,
  HF_MODEL,
  hfInferenceEndpoint,
  makeHuggingFaceModerationPort,
  makeModerationPortFromEnv,
  makeNoopModerationPort,
  MODERATION_RETRY_DELAYS_MS,
  needsRescreen,
  nextRetryDelayMs,
  planModerationStep,
  readModel,
  readScreeningConfig,
  readThreshold,
  sanitizeToken,
  unscoredResult,
} from "./library/adapters/photoModeration";

// Pure-decision unit tests for the moderation port/adapters. No Convex runtime — a fake `fetch`
// stands in for the Hugging Face Inference Providers router, so the decision logic is exercised in
// isolation.

const silentLogger = { warn: vi.fn(), error: vi.fn() };

// Build a fake fetch that returns a given JSON body with a 200 (or a custom status).
const fakeFetch = (
  body: unknown,
  init?: { ok?: boolean; status?: number },
): typeof fetch & ReturnType<typeof vi.fn> =>
  vi.fn(
    async () =>
      ({
        ok: init?.ok ?? true,
        status: init?.status ?? 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as unknown as Response,
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const httpError = (status: number) =>
  fakeFetch({ error: "boom" }, { ok: false, status });

const port = (fetchImpl: typeof fetch, threshold = 0.85) =>
  makeHuggingFaceModerationPort({
    token: "hf_test",
    threshold,
    fetchImpl,
    logger: silentLogger,
  });

const bytes = new Uint8Array([1, 2, 3]);

describe("decideFromScores", () => {
  test("nsfw score at/above threshold => rejected", () => {
    const scores = [
      { label: "nsfw", score: 0.92 },
      { label: "normal", score: 0.08 },
    ];
    expect(decideFromScores(scores, 0.85)).toEqual({
      status: "rejected",
      outcome: "scored",
      score: 0.92,
      label: "nsfw",
      scores,
      reason: null,
      retryable: false,
      httpStatus: 200,
    });
  });

  test("nsfw score below threshold => approved (score retained)", () => {
    const scores = [
      { label: "nsfw", score: 0.1 },
      { label: "normal", score: 0.9 },
    ];
    const result = decideFromScores(scores, 0.85);
    expect(result.status).toBe("approved");
    expect(result.outcome).toBe("scored");
    expect(result.score).toBe(0.1);
  });

  test("threshold boundary is inclusive (>=)", () => {
    expect(
      decideFromScores([{ label: "nsfw", score: 0.85 }], 0.85).status,
    ).toBe("rejected");
  });

  test("no nsfw label => unscored (bad_response), never approved", () => {
    const scores = [{ label: "normal", score: 0.99 }];
    expect(decideFromScores(scores, 0.85)).toEqual({
      status: "unscored",
      outcome: "unscored",
      score: null,
      label: null,
      scores,
      reason: "bad_response",
      retryable: false,
      httpStatus: 200,
    });
    expect(decideFromScores([], 0.85).status).toBe("unscored");
  });

  test("label match is case-insensitive", () => {
    expect(
      decideFromScores([{ label: "NSFW", score: 0.99 }], 0.85).status,
    ).toBe("rejected");
  });
});

describe("readThreshold / readModel / sanitizeToken", () => {
  test("threshold defaults when unset or unparseable or out of range", () => {
    expect(readThreshold(undefined)).toBe(DEFAULT_NSFW_THRESHOLD);
    expect(readThreshold("abc")).toBe(DEFAULT_NSFW_THRESHOLD);
    expect(readThreshold("1.5")).toBe(DEFAULT_NSFW_THRESHOLD);
    expect(readThreshold("-0.1")).toBe(DEFAULT_NSFW_THRESHOLD);
  });

  test("threshold parses a valid float in range", () => {
    expect(readThreshold("0.5")).toBe(0.5);
    expect(readThreshold("0")).toBe(0);
    expect(readThreshold("1")).toBe(1);
  });

  test("model defaults to Falconsai and honours an override", () => {
    expect(readModel(undefined)).toBe(HF_MODEL);
    expect(readModel("  ")).toBe(HF_MODEL);
    expect(readModel(" org/other-model ")).toBe("org/other-model");
  });

  test("token sanitisation strips quotes and whitespace; empty means unset", () => {
    expect(sanitizeToken(' "hf_abc"\n')).toBe("hf_abc");
    expect(sanitizeToken("'hf_abc'")).toBe("hf_abc");
    expect(sanitizeToken("  ")).toBeUndefined();
    expect(sanitizeToken(undefined)).toBeUndefined();
  });
});

describe("classifyHttpFailure", () => {
  test.each([
    [401, "auth", false],
    [403, "auth", false],
    [404, "model_unavailable", false],
    [429, "rate_limited", true],
    [500, "provider_error", true],
    [503, "provider_error", true],
    [400, "provider_error", false],
    [413, "provider_error", false],
  ] as const)("%i => %s (retryable %s)", (status, reason, retryable) => {
    expect(classifyHttpFailure(status)).toEqual({ reason, retryable });
  });
});

describe("makeHuggingFaceModerationPort", () => {
  test("POSTs the raw bytes to the router endpoint with a bearer token and the mime", async () => {
    const fetchImpl = fakeFetch([{ label: "nsfw", score: 0.01 }]);
    await port(fetchImpl).classify(bytes, "image/jpeg");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://router.huggingface.co/hf-inference/models/Falconsai/nsfw_image_detection",
    );
    expect(url).toBe(hfInferenceEndpoint(HF_MODEL));
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer hf_test",
      "Content-Type": "image/jpeg",
    });
    expect(init.body).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (init.body as Blob).arrayBuffer())).toEqual(
      bytes,
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a configured model changes the endpoint", async () => {
    const fetchImpl = fakeFetch([{ label: "nsfw", score: 0.01 }]);
    await makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      model: "org/other-model",
      fetchImpl,
      logger: silentLogger,
    }).classify(bytes);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://router.huggingface.co/hf-inference/models/org/other-model",
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/octet-stream",
    );
  });

  test("missing token => unscored (missing_token), never calls the API", async () => {
    const fetchImpl = vi.fn();
    const result = await makeHuggingFaceModerationPort({
      token: undefined,
      threshold: 0.85,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silentLogger,
    }).classify(bytes);
    expect(result).toEqual(unscoredResult("missing_token", false));
    expect(result.status).toBe("unscored");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("high nsfw score from the API => rejected", async () => {
    const result = await port(
      fakeFetch([
        { label: "nsfw", score: 0.97 },
        { label: "normal", score: 0.03 },
      ]),
    ).classify(bytes);
    expect(result.status).toBe("rejected");
    expect(result.score).toBe(0.97);
    expect(result.outcome).toBe("scored");
  });

  test("low nsfw score from the API => approved", async () => {
    const result = await port(
      fakeFetch([
        { label: "nsfw", score: 0.02 },
        { label: "normal", score: 0.98 },
      ]),
    ).classify(bytes);
    expect(result.status).toBe("approved");
    expect(result.score).toBe(0.02);
  });

  test("custom threshold is honored", async () => {
    const result = await port(
      fakeFetch([{ label: "nsfw", score: 0.6 }]),
      0.5,
    ).classify(bytes);
    expect(result.status).toBe("rejected");
  });

  test("nested [[{label,score}]] response shape is handled", async () => {
    const result = await port(
      fakeFetch([[{ label: "nsfw", score: 0.9 }]]),
    ).classify(bytes);
    expect(result.status).toBe("rejected");
  });

  test("401 => unscored (auth), not retryable, logged", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: httpError(401),
      logger,
    }).classify(bytes);
    expect(result).toEqual(unscoredResult("auth", false, 401));
    expect(logger.error).toHaveBeenCalled();
  });

  test("5xx => unscored (provider_error), retryable", async () => {
    expect(await port(httpError(503)).classify(bytes)).toEqual(
      unscoredResult("provider_error", true, 503),
    );
  });

  test("429 => unscored (rate_limited), retryable", async () => {
    expect(await port(httpError(429)).classify(bytes)).toEqual(
      unscoredResult("rate_limited", true, 429),
    );
  });

  test("thrown fetch error (DNS, timeout) => unscored (network), retryable, logged", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: (async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }) as unknown as typeof fetch,
      logger,
    }).classify(bytes);
    expect(result).toEqual(unscoredResult("network", true));
    expect(logger.error).toHaveBeenCalled();
  });

  test("a non-JSON 200 body => unscored (bad_response)", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
        text: async () => "<html>",
      }) as unknown as Response) as unknown as typeof fetch;
    expect(await port(fetchImpl).classify(bytes)).toEqual(
      unscoredResult("bad_response", false, 200),
    );
  });

  test("an error object in a 200 body => unscored (bad_response)", async () => {
    const result = await port(fakeFetch({ error: "loading" })).classify(bytes);
    expect(result.status).toBe("unscored");
    expect(result.reason).toBe("bad_response");
  });
});

describe("makeModerationPortFromEnv", () => {
  test('provider "none" approves as outcome "disabled" and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await makeModerationPortFromEnv(
      { MODERATION_PROVIDER: "none", HF_MODERATION_TOKEN: "hf_test" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, logger: silentLogger },
    ).classify(bytes);
    expect(result.status).toBe("approved");
    expect(result.outcome).toBe("disabled");
    expect(result.score).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("default provider is huggingface and is unscored with no token", async () => {
    const result = await makeModerationPortFromEnv(
      {},
      { logger: silentLogger },
    ).classify(bytes);
    expect(result).toEqual(unscoredResult("missing_token", false));
  });

  test("a quoted token and a custom model reach the request", async () => {
    const fetchImpl = fakeFetch([{ label: "nsfw", score: 0.1 }]);
    await makeModerationPortFromEnv(
      { HF_MODERATION_TOKEN: '"hf_x"', HF_MODERATION_MODEL: "org/m" },
      { fetchImpl, logger: silentLogger },
    ).classify(bytes);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://router.huggingface.co/hf-inference/models/org/m");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer hf_x",
    );
  });

  test("noop port helper approves as disabled", async () => {
    const result = await makeNoopModerationPort().classify(bytes);
    expect(result.status).toBe("approved");
    expect(result.outcome).toBe("disabled");
  });
});

describe("readScreeningConfig", () => {
  test("ok with a token; missing_token without; disabled with provider none", () => {
    expect(readScreeningConfig({ HF_MODERATION_TOKEN: "hf_x" })).toEqual({
      provider: "huggingface",
      tokenConfigured: true,
      missingVars: [],
      model: HF_MODEL,
      endpoint: hfInferenceEndpoint(HF_MODEL),
      threshold: DEFAULT_NSFW_THRESHOLD,
      status: "ok",
    });
    expect(readScreeningConfig({ HF_MODERATION_TOKEN: " " }).status).toBe(
      "missing_token",
    );
    expect(readScreeningConfig({ MODERATION_PROVIDER: " NONE " }).status).toBe(
      "disabled",
    );
  });

  test("never exposes the token value", () => {
    const config = readScreeningConfig({ HF_MODERATION_TOKEN: "hf_secret" });
    expect(JSON.stringify(config)).not.toContain("hf_secret");
  });
});

describe("retry planning", () => {
  test("backoff schedule: 1 min, 5 min, 30 min, then give up", () => {
    expect(MODERATION_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000]);
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(3)).toBe(1_800_000);
    expect(nextRetryDelayMs(4)).toBeNull();
  });

  test("a retryable unscored result retries while attempts remain, then becomes the verdict", () => {
    const transient = unscoredResult("provider_error", true, 503);
    expect(planModerationStep(transient, 1)).toEqual({
      kind: "retry",
      delayMs: 60_000,
    });
    expect(planModerationStep(transient, 4)).toEqual({
      kind: "verdict",
      result: transient,
    });
  });

  test("a non-retryable unscored result and a scored result are verdicts immediately", () => {
    const config = unscoredResult("auth", false, 401);
    expect(planModerationStep(config, 1)).toEqual({
      kind: "verdict",
      result: config,
    });
    const clean = decideFromScores([{ label: "nsfw", score: 0.01 }], 0.85);
    expect(planModerationStep(clean, 1)).toEqual({
      kind: "verdict",
      result: clean,
    });
  });
});

describe("needsRescreen", () => {
  test("unscored and unchecked-approved rows need a re-screen; decided ones do not", () => {
    expect(needsRescreen({ moderationStatus: "unscored" })).toBe(true);
    expect(needsRescreen({ moderationStatus: "approved" })).toBe(true);
    expect(needsRescreen({})).toBe(true); // legacy: absent status
    expect(
      needsRescreen({ moderationStatus: "approved", moderationScore: 0.01 }),
    ).toBe(false);
    expect(
      needsRescreen({ moderationStatus: "rejected", moderationScore: 0.9 }),
    ).toBe(false);
    expect(needsRescreen({ moderationStatus: "pending" })).toBe(false);
    // An admin's manual decision is final.
    expect(
      needsRescreen({ moderationStatus: "approved", moderatedBy: "u1" }),
    ).toBe(false);
  });
});
