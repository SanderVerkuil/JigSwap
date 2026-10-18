import { describe, expect, test, vi } from "vitest";
import {
  checkAllHashes,
  makeCsamHashCheckPortFromEnv,
  makeOfflimitsCsamHashCheckPort,
  offlimitsHcsWireFormat,
  readCsamHashCheckConfig,
  type CsamHashCheckPort,
} from "./lib/imageModeration/csamHashCheck";

// Unit tests for the CSAM hash-check port and its adapters, with a fake fetch.

const HASHES = {
  md5: "d41d8cd98f00b204e9800998ecf8427e",
  sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
};

const ENV = {
  CSAM_HASHCHECK_PROVIDER: "offlimits",
  OFFLIMITS_HCS_BASE_URL: "https://hcs.example.test/api/check",
  OFFLIMITS_HCS_USERNAME: "jigswap",
  OFFLIMITS_HCS_PASSWORD: "s3cret-pass",
};

const replies = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
  );

describe("offlimits adapter", () => {
  test("POSTs the hashes as JSON with basic auth over HTTPS", async () => {
    const fetchImpl = replies(200, { match: false });
    const port = makeCsamHashCheckPortFromEnv(ENV, { fetchImpl });

    expect(port.provider).toBe("offlimits");
    expect(await port.check(HASHES)).toEqual({ status: "no_match" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(ENV.OFFLIMITS_HCS_BASE_URL);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("jigswap:s3cret-pass")}`);
    expect(headers["Content-Type"]).toBe("application/json");
    // Only the hashes are sent.
    expect(JSON.parse(init.body as string)).toEqual(HASHES);
  });

  test("a listed hash is a match", async () => {
    const port = makeCsamHashCheckPortFromEnv(ENV, {
      fetchImpl: replies(200, { match: true }),
    });
    expect(await port.check(HASHES)).toEqual({ status: "match" });
  });

  test.each([401, 403, 429, 500, 503])(
    "a %i response is unavailable",
    async (status) => {
      const port = makeCsamHashCheckPortFromEnv(ENV, {
        fetchImpl: replies(status, { error: "nope" }),
      });
      expect(await port.check(HASHES)).toEqual({
        status: "unavailable",
        reason: `http_${status}`,
      });
    },
  );

  test("a network error, a non-JSON body or an unexpected shape is unavailable (never a pass)", async () => {
    const network = makeCsamHashCheckPortFromEnv(ENV, {
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(await network.check(HASHES)).toEqual({
      status: "unavailable",
      reason: "network",
    });
    for (const body of ["<html>login</html>", { result: "clean" }, []]) {
      const port = makeCsamHashCheckPortFromEnv(ENV, {
        fetchImpl: replies(200, body),
      });
      expect(await port.check(HASHES)).toEqual({
        status: "unavailable",
        reason: "bad_response",
      });
    }
  });

  test("never follows redirects and caps the response body at 64 KB", async () => {
    const fetchImpl = replies(200, { match: false });
    await makeCsamHashCheckPortFromEnv(ENV, { fetchImpl }).check(HASHES);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.redirect).toBe("error");

    const huge = JSON.stringify({ match: true, pad: "x".repeat(70_000) });
    const streamed = makeCsamHashCheckPortFromEnv(ENV, {
      fetchImpl: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(huge));
                controller.close();
              },
            }),
            { status: 200 },
          ),
      ),
    });
    expect(await streamed.check(HASHES)).toEqual({
      status: "unavailable",
      reason: "response_too_large",
    });
    const declared = makeCsamHashCheckPortFromEnv(ENV, {
      fetchImpl: vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-length": "999999" },
          }),
      ),
    });
    expect(await declared.check(HASHES)).toEqual({
      status: "unavailable",
      reason: "response_too_large",
    });
  });

  test("refuses to send credentials to a non-HTTPS URL", async () => {
    const fetchImpl = replies(200, { match: false });
    const port = makeOfflimitsCsamHashCheckPort({
      baseUrl: "http://hcs.example.test/api/check",
      username: "u",
      password: "p",
      fetchImpl,
    });
    expect(await port.check(HASHES)).toEqual({
      status: "unavailable",
      reason: "insecure_url",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("the provisional wire format is one documented mapping", () => {
    expect(JSON.parse(offlimitsHcsWireFormat.requestBody(HASHES))).toEqual(
      HASHES,
    );
    expect(offlimitsHcsWireFormat.parseResponse({ match: true })).toBe("match");
    expect(offlimitsHcsWireFormat.parseResponse({ match: false })).toBe(
      "no_match",
    );
    expect(offlimitsHcsWireFormat.parseResponse({ match: "yes" })).toBeNull();
    expect(offlimitsHcsWireFormat.parseResponse(null)).toBeNull();
  });
});

describe("configuration", () => {
  test("unconfigured defaults to none: always no_match, no HTTP call", async () => {
    const fetchImpl = vi.fn();
    const port = makeCsamHashCheckPortFromEnv({}, { fetchImpl });
    expect(port.provider).toBe("none");
    expect(await port.check(HASHES)).toEqual({ status: "no_match" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readCsamHashCheckConfig({})).toEqual({
      provider: "none",
      status: "disabled",
      missingVars: [],
    });
  });

  test("offlimits with missing config is inert (none) and names the missing vars, never values", async () => {
    const fetchImpl = vi.fn();
    const env = { ...ENV, OFFLIMITS_HCS_PASSWORD: " " };
    const port = makeCsamHashCheckPortFromEnv(env, { fetchImpl });
    expect(port.provider).toBe("none");
    expect(await port.check(HASHES)).toEqual({ status: "no_match" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const config = readCsamHashCheckConfig(env);
    expect(config).toEqual({
      provider: "offlimits",
      status: "missing_config",
      missingVars: ["OFFLIMITS_HCS_PASSWORD"],
    });
    expect(JSON.stringify(readCsamHashCheckConfig(ENV))).not.toContain(
      "s3cret-pass",
    );
  });

  test("an unknown provider name means none", () => {
    expect(
      readCsamHashCheckConfig({ CSAM_HASHCHECK_PROVIDER: "offlimitz" })
        .provider,
    ).toBe("none");
    expect(
      readCsamHashCheckConfig({
        ...ENV,
        CSAM_HASHCHECK_PROVIDER: '"Offlimits"',
      }).status,
    ).toBe("ok");
  });
});

describe("checkAllHashes", () => {
  const OTHER = { md5: "a".repeat(32), sha1: "b".repeat(40) };
  const portFrom = (
    answers: Record<string, "match" | "no_match" | "unavailable" | "throw">,
  ): CsamHashCheckPort => ({
    provider: "offlimits",
    async check(hashes) {
      const answer = answers[hashes.md5];
      if (answer === "throw") throw new Error("boom");
      return { status: answer };
    },
  });

  test("a match on any variant wins and reports the matched pair", async () => {
    const port = portFrom({
      [HASHES.md5]: "unavailable",
      [OTHER.md5]: "match",
    });
    expect(await checkAllHashes(port, [HASHES, OTHER])).toEqual({
      status: "match",
      matched: OTHER,
    });
  });

  test("unavailable when any check could not answer and none matched; no_match otherwise", async () => {
    expect(
      await checkAllHashes(
        portFrom({ [HASHES.md5]: "no_match", [OTHER.md5]: "throw" }),
        [HASHES, OTHER],
      ),
    ).toEqual({ status: "unavailable", reason: "internal_error" });
    expect(
      await checkAllHashes(
        portFrom({ [HASHES.md5]: "no_match", [OTHER.md5]: "no_match" }),
        [HASHES, OTHER],
      ),
    ).toEqual({ status: "no_match" });
  });
});
