import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_NSFW_THRESHOLD,
  decideFromScores,
  makeHuggingFaceModerationPort,
  makeModerationPortFromEnv,
  makeNoopModerationPort,
  readThreshold,
} from "./library/adapters/photoModeration";

// Pure-decision unit tests for the moderation port/adapters. No Convex runtime — a fake `fetch`
// stands in for the Hugging Face Inference API, so the decision logic is exercised in isolation.

const silentLogger = { warn: vi.fn(), error: vi.fn() };

// Build a fake fetch that returns a given JSON body with a 200 (or a custom status).
const fakeFetch =
  (body: unknown, init?: { ok?: boolean; status?: number }): typeof fetch =>
  async () =>
    ({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

describe("decideFromScores", () => {
  test("nsfw score at/above threshold => rejected", () => {
    const result = decideFromScores(
      [
        { label: "nsfw", score: 0.92 },
        { label: "normal", score: 0.08 },
      ],
      0.85,
    );
    expect(result).toEqual({
      status: "rejected",
      score: 0.92,
      label: "nsfw",
      scores: [
        { label: "nsfw", score: 0.92 },
        { label: "normal", score: 0.08 },
      ],
    });
  });

  test("nsfw score below threshold => approved (score retained)", () => {
    const result = decideFromScores(
      [
        { label: "nsfw", score: 0.1 },
        { label: "normal", score: 0.9 },
      ],
      0.85,
    );
    expect(result).toEqual({
      status: "approved",
      score: 0.1,
      label: "nsfw",
      scores: [
        { label: "nsfw", score: 0.1 },
        { label: "normal", score: 0.9 },
      ],
    });
  });

  test("threshold boundary is inclusive (>=)", () => {
    expect(
      decideFromScores([{ label: "nsfw", score: 0.85 }], 0.85).status,
    ).toBe("rejected");
    expect(
      decideFromScores([{ label: "nsfw", score: 0.8499 }], 0.85).status,
    ).toBe("approved");
  });

  test("no nsfw label => approved with null score", () => {
    expect(decideFromScores([{ label: "normal", score: 0.99 }], 0.85)).toEqual({
      status: "approved",
      score: null,
      label: null,
      scores: [{ label: "normal", score: 0.99 }],
    });
  });

  test("label match is case-insensitive", () => {
    expect(decideFromScores([{ label: "NSFW", score: 0.9 }], 0.85).status).toBe(
      "rejected",
    );
  });
});

describe("readThreshold", () => {
  test("defaults when unset or unparseable or out of range", () => {
    expect(readThreshold(undefined)).toBe(DEFAULT_NSFW_THRESHOLD);
    expect(readThreshold("not-a-number")).toBe(DEFAULT_NSFW_THRESHOLD);
    expect(readThreshold("-0.1")).toBe(DEFAULT_NSFW_THRESHOLD);
    expect(readThreshold("1.5")).toBe(DEFAULT_NSFW_THRESHOLD);
  });

  test("parses a valid float in range", () => {
    expect(readThreshold("0.5")).toBe(0.5);
    expect(readThreshold("0")).toBe(0);
    expect(readThreshold("1")).toBe(1);
  });
});

describe("makeHuggingFaceModerationPort", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  test("missing token => approved without classification (fail-open, disabled)", async () => {
    const fetchImpl = vi.fn();
    const port = makeHuggingFaceModerationPort({
      token: undefined,
      threshold: 0.85,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: silentLogger,
    });
    const result = await port.classify(bytes);
    expect(result).toEqual({
      status: "approved",
      score: null,
      label: null,
      scores: [],
    });
    // It must NOT call the API when unconfigured.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("high nsfw score from the API => rejected", async () => {
    const port = makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: fakeFetch([
        { label: "nsfw", score: 0.97 },
        { label: "normal", score: 0.03 },
      ]),
      logger: silentLogger,
    });
    expect(await port.classify(bytes)).toEqual({
      status: "rejected",
      score: 0.97,
      label: "nsfw",
      scores: [
        { label: "nsfw", score: 0.97 },
        { label: "normal", score: 0.03 },
      ],
    });
  });

  test("low nsfw score from the API => approved", async () => {
    const port = makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: fakeFetch([
        { label: "nsfw", score: 0.02 },
        { label: "normal", score: 0.98 },
      ]),
      logger: silentLogger,
    });
    expect(await port.classify(bytes)).toEqual({
      status: "approved",
      score: 0.02,
      label: "nsfw",
      scores: [
        { label: "nsfw", score: 0.02 },
        { label: "normal", score: 0.98 },
      ],
    });
  });

  test("custom threshold is honored", async () => {
    const port = makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.5,
      fetchImpl: fakeFetch([{ label: "nsfw", score: 0.6 }]),
      logger: silentLogger,
    });
    expect((await port.classify(bytes)).status).toBe("rejected");
  });

  test("nested [[{label,score}]] response shape is handled", async () => {
    const port = makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: fakeFetch([[{ label: "nsfw", score: 0.9 }]]),
      logger: silentLogger,
    });
    expect((await port.classify(bytes)).status).toBe("rejected");
  });

  test("non-OK API response => approved (fail-open) and logs", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const port = makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: fakeFetch({ error: "boom" }, { ok: false, status: 503 }),
      logger,
    });
    expect(await port.classify(bytes)).toEqual({
      status: "approved",
      score: null,
      label: null,
      scores: [],
    });
    expect(logger.error).toHaveBeenCalled();
  });

  test("thrown fetch error => approved (fail-open) and logs", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const port = makeHuggingFaceModerationPort({
      token: "hf_test",
      threshold: 0.85,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      logger,
    });
    expect((await port.classify(bytes)).status).toBe("approved");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("makeModerationPortFromEnv", () => {
  const bytes = new Uint8Array([1]);

  test('provider "none" always approves and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const port = makeModerationPortFromEnv(
      { MODERATION_PROVIDER: "none", HF_MODERATION_TOKEN: "hf_test" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, logger: silentLogger },
    );
    expect(await port.classify(bytes)).toEqual({
      status: "approved",
      score: null,
      label: null,
      scores: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("default provider is huggingface (and fails open with no token)", async () => {
    const port = makeModerationPortFromEnv({}, { logger: silentLogger });
    expect(await port.classify(bytes)).toEqual({
      status: "approved",
      score: null,
      label: null,
      scores: [],
    });
  });

  test("noop port helper always approves", async () => {
    expect(await makeNoopModerationPort().classify(bytes)).toEqual({
      status: "approved",
      score: null,
      label: null,
      scores: [],
    });
  });
});
