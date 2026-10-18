import { describe, expect, test, vi } from "vitest";
import {
  classifySightengineFailure,
  decideFromSightengine,
  makeModerationPortFromEnv,
  makeSightengineModerationPort,
  readProvider,
  readScreeningConfig,
  SIGHTENGINE_ENDPOINT,
  unscoredResult,
} from "./library/adapters/photoModeration";

// Unit tests for the Sightengine adapter (nudity-2.1). A fake fetch stands in for
// api.sightengine.com; the credentials are fake and must never appear in logs.

const bytes = new Uint8Array([1, 2, 3]);
const SECRET = "fake-secret-value";

const nudity = (scores: Partial<Record<string, number>>) => ({
  status: "success",
  request: { id: "req_1", timestamp: 1, operations: 1 },
  nudity: {
    sexual_activity: 0.001,
    sexual_display: 0.001,
    erotica: 0.001,
    very_suggestive: 0.002,
    suggestive: 0.003,
    mildly_suggestive: 0.004,
    none: 0.99,
    suggestive_classes: { bikini: 0.001 },
    context: { indoor_other: 0.9 },
    ...scores,
  },
  media: { id: "med_1", uri: "photo.jpg" },
});

const reply = (body: unknown, status = 200) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

const port = (
  fetchImpl: typeof fetch,
  logger = { warn: vi.fn(), error: vi.fn() },
) =>
  makeSightengineModerationPort({
    apiUser: "123",
    apiSecret: SECRET,
    threshold: 0.85,
    fetchImpl,
    logger,
  });

describe("decideFromSightengine", () => {
  test("the decisive score is the highest explicit class", () => {
    const result = decideFromSightengine(
      nudity({ erotica: 0.91, sexual_display: 0.4 }),
      0.85,
    );
    expect(result.status).toBe("rejected");
    expect(result.outcome).toBe("scored");
    expect(result.score).toBe(0.91);
    expect(result.label).toBe("erotica");
    expect(result.scores.map((s) => s.label)).toEqual([
      "sexual_activity",
      "sexual_display",
      "erotica",
      "very_suggestive",
      "suggestive",
      "mildly_suggestive",
      "none",
    ]);
  });

  test("suggestive-only content (swimwear, cleavage) is approved", () => {
    const result = decideFromSightengine(
      nudity({ very_suggestive: 0.95, suggestive: 0.97, none: 0.02 }),
      0.85,
    );
    expect(result.status).toBe("approved");
    expect(result.score).toBe(0.001);
  });

  test("a body without the explicit classes is unscored (bad_response)", () => {
    expect(decideFromSightengine({ status: "success" }, 0.85).reason).toBe(
      "bad_response",
    );
    expect(decideFromSightengine({ nudity: { none: 0.9 } }, 0.85).status).toBe(
      "unscored",
    );
  });
});

describe("classifySightengineFailure", () => {
  test.each([
    [429, undefined, "rate_limited", true],
    [400, "usage_limit", "rate_limited", true],
    [401, undefined, "auth", false],
    [400, "credentials_error", "auth", false],
    [400, "plan_error", "auth", false],
    [500, undefined, "provider_error", true],
    [200, "api_error", "provider_error", true],
    [400, "media_error", "provider_error", false],
    [400, "argument_error", "provider_error", false],
  ] as const)(
    "%i / %s => %s (retryable %s)",
    (status, type, reason, retryable) => {
      expect(classifySightengineFailure(status, type)).toEqual({
        reason,
        retryable,
      });
    },
  );
});

describe("makeSightengineModerationPort", () => {
  test("multipart-uploads the image with the nudity model and credentials", async () => {
    const fetchImpl = reply(nudity({}));
    const result = await port(fetchImpl).classify(bytes, "image/jpeg");
    expect(result.status).toBe("approved");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.sightengine.com/1.0/check.json");
    expect(url).toBe(SIGHTENGINE_ENDPOINT);
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("models")).toBe("nudity-2.1");
    expect(form.get("api_user")).toBe("123");
    expect(form.get("api_secret")).toBe(SECRET);
    const media = form.get("media") as File;
    expect(media.type).toBe("image/jpeg");
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(bytes);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("an explicit image is rejected", async () => {
    const result = await port(
      reply(nudity({ sexual_activity: 0.97 })),
    ).classify(bytes);
    expect(result.status).toBe("rejected");
    expect(result.label).toBe("sexual_activity");
  });

  test("missing credentials => unscored (missing_token), no HTTP call", async () => {
    const fetchImpl = vi.fn();
    const result = await makeSightengineModerationPort({
      apiUser: "123",
      apiSecret: undefined,
      threshold: 0.85,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn: vi.fn(), error: vi.fn() },
    }).classify(bytes);
    expect(result).toEqual(unscoredResult("missing_token", false));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("bad credentials => unscored (auth), logged without the secret", async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await port(
      reply(
        {
          status: "failure",
          error: {
            type: "credentials_error",
            code: 1,
            message: "Incorrect API user or API secret",
          },
        },
        401,
      ),
      logger,
    ).classify(bytes);
    expect(result).toEqual(unscoredResult("auth", false, 401));
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SECRET);
  });

  test("a failure body with HTTP 200 is still a failure", async () => {
    const result = await port(
      reply({ status: "failure", error: { type: "media_error", code: 21 } }),
    ).classify(bytes);
    expect(result).toEqual(unscoredResult("provider_error", false, 200));
  });

  test("429 and 5xx are retryable; a network error too", async () => {
    expect((await port(reply({}, 429)).classify(bytes)).retryable).toBe(true);
    expect((await port(reply({}, 503)).classify(bytes)).reason).toBe(
      "provider_error",
    );
    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await port(
      (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      logger,
    ).classify(bytes);
    expect(result).toEqual(unscoredResult("network", true));
  });

  test("a non-JSON 200 body => unscored (bad_response)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>", { status: 200 }),
    );
    expect(await port(fetchImpl).classify(bytes)).toEqual(
      unscoredResult("bad_response", false, 200),
    );
  });
});

describe("provider selection", () => {
  test('MODERATION_PROVIDER="sightengine" selects Sightengine; HF stays the default', async () => {
    expect(readProvider("sightengine")).toBe("sightengine");
    expect(readProvider(" SightEngine ")).toBe("sightengine");
    expect(readProvider(undefined)).toBe("huggingface");
    expect(readProvider("sightengin")).toBe("huggingface");

    const fetchImpl = reply(nudity({}));
    await makeModerationPortFromEnv(
      {
        MODERATION_PROVIDER: "sightengine",
        SIGHTENGINE_API_USER: "123",
        SIGHTENGINE_SECRET_KEY: `"${SECRET}"\n`,
      },
      { fetchImpl, logger: { warn: vi.fn(), error: vi.fn() } },
    ).classify(bytes);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(SIGHTENGINE_ENDPOINT);
    // The env value is sanitised (quotes/newline stripped).
    expect((init.body as FormData).get("api_secret")).toBe(SECRET);
  });

  test("the screening config names the missing vars, never their values", () => {
    const missing = readScreeningConfig({
      MODERATION_PROVIDER: "sightengine",
      SIGHTENGINE_SECRET_KEY: SECRET,
    });
    expect(missing).toMatchObject({
      provider: "sightengine",
      status: "missing_token",
      tokenConfigured: false,
      missingVars: ["SIGHTENGINE_API_USER"],
      model: "nudity-2.1",
      endpoint: SIGHTENGINE_ENDPOINT,
    });
    expect(JSON.stringify(missing)).not.toContain(SECRET);

    const ok = readScreeningConfig({
      MODERATION_PROVIDER: "sightengine",
      SIGHTENGINE_API_USER: "123",
      SIGHTENGINE_SECRET_KEY: SECRET,
    });
    expect(ok.status).toBe("ok");
    expect(ok.missingVars).toEqual([]);
    expect(
      readScreeningConfig({ HF_MODERATION_TOKEN: "x" }).missingVars,
    ).toEqual([]);
    expect(readScreeningConfig({}).missingVars).toEqual([
      "HF_MODERATION_TOKEN",
    ]);
  });
});
