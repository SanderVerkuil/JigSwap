"use node";

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { isPrivateIp } from "@jigswap/domain";
import { Agent, fetch as undiciFetch, type Response } from "undici";

// SSRF-safe outbound HTTP for the URL import: every page tier that fetches from our own network
// (ogie, browser) and the box-art image fetch go through fetchPublic.
//
// The address check happens at CONNECT time, inside the socket's own DNS lookup: an undici Agent
// whose `connect.lookup` resolves the host, refuses the connection if ANY answer is non-public
// (isPrivateIp), and otherwise hands net.connect only those validated answers. The socket can
// therefore never dial an address that was not checked, which closes the DNS-rebinding window a
// separate "resolve, check, then fetch()" pre-flight leaves open (fetch resolves again on its own).
// net.connect skips the lookup for an IP-literal host, so literals are checked before dispatch.
// Redirects are followed by hand so every hop is checked the same way. The Agent is passed per
// request, never installed with setGlobalDispatcher, so the action's other fetches (Convex calls,
// Firecrawl, moderation) keep the default transport.

export class BlockedAddressError extends Error {
  override readonly name = "BlockedAddressError";
  constructor(
    readonly hostname: string,
    readonly address: string | null,
  ) {
    super(`Refused to fetch (blocked address): ${hostname}`);
  }
}

/** Resolves a hostname to every address it has (dns.lookup with all:true). */
export type ResolveHost = (hostname: string) => Promise<LookupAddress[]>;

const systemResolve: ResolveHost = (hostname) =>
  dnsLookup(hostname, { all: true });

// net.connect calls this with all:true (happy eyeballs) or all:false; both callback forms are
// served. Every answer is checked before any is returned.
const guardedLookup =
  (resolve: ResolveHost, isBlocked: (ip: string) => boolean): LookupFunction =>
  (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const [first] = addresses;
        const refused = addresses.find((a) => isBlocked(a.address));
        if (first === undefined || refused !== undefined) {
          callback(
            new BlockedAddressError(hostname, refused?.address ?? null),
            [],
          );
        } else if (options.all === true) {
          callback(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, []),
    );
  };

// undici reports a failed lookup as TypeError("fetch failed") with the lookup error as its cause.
const blockedCause = (error: unknown): BlockedAddressError | null => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof BlockedAddressError) return current;
    current = "cause" in current ? current.cause : undefined;
  }
  return null;
};

const isRedirectStatus = (status: number) => status >= 300 && status < 400;

const parseHttpUrl = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export type PublicFetchOutcome =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; code: "InvalidUrl" | "Blocked"; detail: string };

export interface PublicFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Redirect hops to follow. A redirect past the limit is returned as the response. */
  maxRedirects: number;
}

export const makePublicFetch = ({
  resolve = systemResolve,
  isBlocked = isPrivateIp,
}: {
  resolve?: ResolveHost;
  isBlocked?: (ip: string) => boolean;
} = {}) => {
  const dispatcher = new Agent({
    connect: { lookup: guardedLookup(resolve, isBlocked) },
  });

  // GET `url` from a public address only. Returns the response (a 3xx only when the redirect limit
  // is reached or it has no Location), or a refusal: InvalidUrl for a non-http(s) or unparseable
  // url or redirect target, Blocked for a non-public address. Network errors and an aborted
  // `signal` (TimeoutError for AbortSignal.timeout) are thrown as fetch() throws them.
  const fetchPublic = async (
    url: string,
    { headers, signal, maxRedirects }: PublicFetchOptions,
  ): Promise<PublicFetchOutcome> => {
    let currentUrl = url;
    for (let hop = 0; ; hop++) {
      const target = parseHttpUrl(currentUrl);
      if (target === null) {
        return {
          ok: false,
          code: "InvalidUrl",
          detail: `Not an http(s) URL: ${currentUrl}`,
        };
      }
      const literal = target.hostname.replace(/^\[(.*)\]$/, "$1");
      if (isIP(literal) !== 0 && isBlocked(literal)) {
        return {
          ok: false,
          code: "Blocked",
          detail: new BlockedAddressError(target.hostname, literal).message,
        };
      }

      let response: Response;
      try {
        response = await undiciFetch(currentUrl, {
          headers,
          signal,
          redirect: "manual",
          dispatcher,
        });
      } catch (error) {
        const blocked = blockedCause(error);
        if (blocked !== null) {
          return { ok: false, code: "Blocked", detail: blocked.message };
        }
        throw error;
      }

      const location = response.headers.get("location");
      if (
        !isRedirectStatus(response.status) ||
        location === null ||
        hop >= maxRedirects
      ) {
        return { ok: true, response, finalUrl: currentUrl };
      }
      await response.body?.cancel();
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return {
          ok: false,
          code: "InvalidUrl",
          detail: `Unparseable redirect from ${currentUrl}`,
        };
      }
    }
  };

  return { fetchPublic, close: () => dispatcher.close() };
};

export const { fetchPublic } = makePublicFetch();

// Read at most `maxBytes` of a body, cancelling the stream (and so the connection) at the cap
// instead of buffering the rest. `truncated` is true when the body had more. The cap counts
// decoded bytes, so a compressed body cannot inflate past it.
export const readBodyCapped = async (
  response: Pick<Response, "body">,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; truncated: boolean }> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  if (response.body !== null) {
    const reader = response.body.getReader();
    for (;;) {
      // undici types the body's chunks as `any`; they are Uint8Array.
      const { done, value } = (await reader.read()) as {
        done: boolean;
        value?: Uint8Array;
      };
      if (done || value === undefined) break;
      if (total + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
};
