import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { assertPublicUrl } from "./catalog/adapters/assertPublicUrl";
import {
  makePublicFetch,
  readBodyCapped,
  type ResolveHost,
} from "./catalog/adapters/publicFetch";

// The URL import's outbound transport (catalog/adapters/publicFetch): the address check runs inside
// the socket's own DNS lookup, so a host that resolves (or re-resolves) to a non-public address is
// refused before any byte is sent. A real node:http server on 127.0.0.1 plays every "internal"
// service: when the guard works, it never sees a request.

// The SSRF pre-flight in assertPublicUrl resolves through node:dns/promises: answer with a public
// address, as an attacker's rebinding DNS would on the first query.
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

type Route = (res: ServerResponse) => void;

let server: Server;
let port: number;
let requests: string[];
let routes: Map<string, Route>;
const closers: Array<() => Promise<void>> = [];

beforeEach(async () => {
  requests = [];
  routes = new Map();
  server = createServer((req, res) => {
    requests.push(`${req.headers.host?.split(":")[0]}${req.url}`);
    const route = routes.get(req.url ?? "");
    if (route) route(res);
    else
      res
        .writeHead(200, { "content-type": "text/html" })
        .end("<title>internal</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Every hostname "resolves" to the test server; the resolver records each lookup.
const loopbackResolver =
  (lookups: string[] = []): ResolveHost =>
  async (hostname) => {
    lookups.push(hostname);
    return [{ address: "127.0.0.1", family: 4 }];
  };

const transport = (options: Parameters<typeof makePublicFetch>[0]) => {
  const made = makePublicFetch(options);
  closers.push(made.close);
  return made.fetchPublic;
};

// The test server is the only address a test may reach.
const onlyTestServer = (ip: string) => ip !== "127.0.0.1";

describe("fetchPublic refuses non-public addresses at connect time", () => {
  test("a hostname resolving to loopback is refused and never contacted", async () => {
    const lookups: string[] = [];
    const fetchPublic = transport({ resolve: loopbackResolver(lookups) });

    // "localhost." (trailing dot) got past ogie's lexical private-URL check.
    const outcome = await fetchPublic(`http://localhost.:${port}/admin`, {
      maxRedirects: 0,
    });

    expect(outcome).toMatchObject({ ok: false, code: "Blocked" });
    expect(lookups).toEqual(["localhost."]);
    expect(requests).toEqual([]);
  });

  test("IP-literal hosts are refused before dispatch, without a lookup", async () => {
    const lookups: string[] = [];
    const fetchPublic = transport({ resolve: loopbackResolver(lookups) });

    for (const url of [
      `http://127.0.0.1:${port}/`,
      `http://[::1]:${port}/`,
      `http://[::ffff:127.0.0.1]:${port}/`,
      "http://169.254.169.254/latest/meta-data/",
      `http://2130706433:${port}/`, // 127.0.0.1 as one number
    ]) {
      expect(await fetchPublic(url, { maxRedirects: 0 }), url).toMatchObject({
        ok: false,
        code: "Blocked",
      });
    }
    expect(lookups).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("a DNS rebind between the pre-flight and the connection is refused", async () => {
    const url = `http://rebind.example:${port}/internal`;
    // The pre-flight sees the attacker's public answer...
    expect(await assertPublicUrl(url)).toEqual({ ok: true });

    // ...and the connection's own lookup gets loopback: refused, nothing sent.
    const fetchPublic = transport({ resolve: loopbackResolver() });
    expect(await fetchPublic(url, { maxRedirects: 0 })).toMatchObject({
      ok: false,
      code: "Blocked",
    });
    expect(requests).toEqual([]);
  });

  test("a host is refused when any one of its addresses is non-public", async () => {
    const fetchPublic = transport({
      resolve: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      isBlocked: onlyTestServer,
    });

    expect(
      await fetchPublic(`http://mixed.test:${port}/`, { maxRedirects: 0 }),
    ).toMatchObject({ ok: false, code: "Blocked" });
    expect(requests).toEqual([]);
  });

  test("non-http(s) URLs are refused", async () => {
    const fetchPublic = transport({ resolve: loopbackResolver() });
    for (const url of [
      "file:///etc/passwd",
      "ftp://store.test/",
      "not a url",
    ]) {
      expect(await fetchPublic(url, { maxRedirects: 0 }), url).toMatchObject({
        ok: false,
        code: "InvalidUrl",
      });
    }
  });
});

describe("fetchPublic follows redirects one checked hop at a time", () => {
  const redirect =
    (location: string): Route =>
    (res) =>
      res.writeHead(302, { location }).end();

  test("each hop is resolved and checked again", async () => {
    routes.set("/start", redirect(`http://second.test:${port}/end`));
    const lookups: string[] = [];
    const fetchPublic = transport({
      resolve: loopbackResolver(lookups),
      isBlocked: onlyTestServer,
    });

    const outcome = await fetchPublic(`http://first.test:${port}/start`, {
      maxRedirects: 5,
    });

    expect(outcome).toMatchObject({
      ok: true,
      finalUrl: `http://second.test:${port}/end`,
    });
    if (outcome.ok) expect(outcome.response.status).toBe(200);
    expect(lookups).toEqual(["first.test", "second.test"]);
    expect(requests).toEqual(["first.test/start", "second.test/end"]);
  });

  test("a redirect to a host that resolves to a blocked address is refused", async () => {
    routes.set("/start", redirect(`http://internal.test:${port}/secret`));
    const fetchPublic = transport({
      resolve: async (hostname) => [
        {
          address: hostname === "internal.test" ? "10.0.0.1" : "127.0.0.1",
          family: 4,
        },
      ],
      isBlocked: onlyTestServer,
    });

    expect(
      await fetchPublic(`http://shop.test:${port}/start`, { maxRedirects: 5 }),
    ).toMatchObject({ ok: false, code: "Blocked" });
    expect(requests).toEqual(["shop.test/start"]);
  });

  test("a redirect to a blocked IP literal or a non-http(s) scheme is refused", async () => {
    const fetchPublic = transport({
      resolve: loopbackResolver(),
      isBlocked: onlyTestServer,
    });

    routes.set(
      "/metadata",
      redirect("http://169.254.169.254/latest/meta-data/"),
    );
    expect(
      await fetchPublic(`http://shop.test:${port}/metadata`, {
        maxRedirects: 5,
      }),
    ).toMatchObject({ ok: false, code: "Blocked" });

    routes.set("/file", redirect("file:///etc/passwd"));
    expect(
      await fetchPublic(`http://shop.test:${port}/file`, { maxRedirects: 5 }),
    ).toMatchObject({ ok: false, code: "InvalidUrl" });
  });

  test("maxRedirects 0 returns the redirect itself without following it", async () => {
    routes.set("/start", redirect(`http://second.test:${port}/end`));
    const fetchPublic = transport({
      resolve: loopbackResolver(),
      isBlocked: onlyTestServer,
    });

    const outcome = await fetchPublic(`http://first.test:${port}/start`, {
      maxRedirects: 0,
    });

    expect(outcome.ok && outcome.response.status).toBe(302);
    expect(requests).toEqual(["first.test/start"]);
  });

  test("past the redirect limit the last redirect is returned", async () => {
    routes.set("/loop", redirect("/loop"));
    const fetchPublic = transport({
      resolve: loopbackResolver(),
      isBlocked: onlyTestServer,
    });

    const outcome = await fetchPublic(`http://shop.test:${port}/loop`, {
      maxRedirects: 2,
    });

    expect(outcome.ok && outcome.response.status).toBe(302);
    expect(requests).toHaveLength(3);
  });

  test("an aborted signal rejects with its reason (TimeoutError for AbortSignal.timeout)", async () => {
    routes.set("/slow", () => {}); // never answers
    const fetchPublic = transport({
      resolve: loopbackResolver(),
      isBlocked: onlyTestServer,
    });

    await expect(
      fetchPublic(`http://shop.test:${port}/slow`, {
        maxRedirects: 0,
        signal: AbortSignal.timeout(50),
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

describe("readBodyCapped", () => {
  const MB = 1024 * 1024;

  test("stops reading at the cap and closes the connection", async () => {
    let finished = false;
    let closedEarly = false;
    routes.set("/huge", (res) => {
      // 25 MB, chunked (no content-length), written as fast as the socket takes it.
      res.writeHead(200, { "content-type": "text/html" });
      let sent = 0;
      res.on("close", () => {
        closedEarly = !res.writableFinished;
      });
      const pump = () => {
        while (sent < 25 * MB) {
          sent += 64 * 1024;
          if (!res.write(Buffer.alloc(64 * 1024, 0x61))) {
            res.once("drain", pump);
            return;
          }
        }
        finished = true;
        res.end();
      };
      pump();
    });
    const fetchPublic = transport({
      resolve: loopbackResolver(),
      isBlocked: onlyTestServer,
    });

    const outcome = await fetchPublic(`http://shop.test:${port}/huge`, {
      maxRedirects: 0,
    });
    if (!outcome.ok) throw new Error(outcome.detail);
    const { bytes, truncated } = await readBodyCapped(outcome.response, MB);

    expect(truncated).toBe(true);
    expect(bytes.byteLength).toBe(MB);
    await vi.waitFor(() => expect(closedEarly).toBe(true));
    expect(finished).toBe(false);
  });

  test("returns a body within the cap whole", async () => {
    routes.set("/page", (res) => res.writeHead(200).end("x".repeat(1000)));
    const fetchPublic = transport({
      resolve: loopbackResolver(),
      isBlocked: onlyTestServer,
    });

    const outcome = await fetchPublic(`http://shop.test:${port}/page`, {
      maxRedirects: 0,
    });
    if (!outcome.ok) throw new Error(outcome.detail);

    expect(await readBodyCapped(outcome.response, 1000)).toEqual({
      bytes: new TextEncoder().encode("x".repeat(1000)),
      truncated: false,
    });
  });
});
