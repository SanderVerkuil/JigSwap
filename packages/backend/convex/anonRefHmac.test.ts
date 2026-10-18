import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { anonRefOf, projectMemberIdentity } from "./social/privacy";

// #178: a hidden member's anonRef must not be reproducible offline. It is an HMAC-SHA256 keyed by
// the server-only ANON_REF_SECRET (test-setup.ts sets a dummy, non-secret value), so a viewer who
// knows the salt (thread/copy id) and a list of candidate member ids can no longer recompute it.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const TEST_SECRET = process.env.ANON_REF_SECRET as string;
const OTHER_SECRET = "another-dummy-test-only-anon-ref-key-0123456789";

// The pre-#178 derivation, copied verbatim: unkeyed cyrb53 over `${targetId}:${salt}`.
const cyrb53 = (str: string, seed = 0): string => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36);
};

// An independent HMAC-SHA256 under an arbitrary key, encoded the way privacy.ts documents it, so
// the test pins the construction: only the right key reproduces the ref. Web Crypto rejects a
// zero-length key, so EMPTY_KEY is a single NUL byte: HMAC zero-pads keys to the block size, so it
// is the same key as the empty one.
const EMPTY_KEY = "\u0000";
const hmacRef = async (key: string, targetId: string, salt: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(JSON.stringify(["anonRef/v1", targetId, salt])),
    ),
  );
  // RFC 4648 base32 (lowercase) of the first 80 bits, via a bit string.
  const bitString = [...sig.subarray(0, 10)]
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  return (bitString.match(/.{5}/g) ?? [])
    .map((chunk) => alphabet[parseInt(chunk, 2)])
    .join("");
};

const withSecret = (value: string | undefined) => {
  if (value === undefined) delete process.env.ANON_REF_SECRET;
  else process.env.ANON_REF_SECRET = value;
};

afterEach(() => {
  withSecret(TEST_SECRET);
  vi.restoreAllMocks();
});

const seedHidden = (t: T) =>
  t.run(async (ctx) => {
    const now = 1_000_000;
    const mk = (who: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        username: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const viewer = await mk("viewer");
    const hidden = await mk("hidden");
    await ctx.db.insert("profiles", {
      aggregateId: "prof-hidden",
      memberId: hidden,
      displayName: "X",
      visibility: "private",
      updatedAt: now,
    });
    return { viewer, hidden };
  });

const refFor = async (
  t: T,
  viewer: Id<"users">,
  hidden: Id<"users">,
  salt: string,
) =>
  t.run(async (ctx) => {
    const p = await projectMemberIdentity(ctx, viewer, hidden, salt);
    if (!p.anonymous) throw new Error("expected an anonymous projection");
    return p.anonRef;
  });

describe("anonRef is a keyed HMAC (#178)", () => {
  test("the test setup provides a dummy secret of the minimum length", () => {
    expect(TEST_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  test("same key + inputs is stable; it equals HMAC-SHA256 under that key and nothing else", async () => {
    const t = convexTest(schema, modules);
    const { viewer, hidden } = await seedHidden(t);
    const salt = "copy-1";

    const a = await refFor(t, viewer, hidden, salt);
    const b = await refFor(t, viewer, hidden, salt);
    expect(a).toBe(b);
    // ≥ 64 bits of output: an 80-bit truncation is exactly 16 base32 characters.
    expect(a).toMatch(/^[a-z2-7]{16}$/);

    expect(a).toBe(await hmacRef(TEST_SECRET, hidden, salt));
    // Not reproducible from public inputs: not the old unkeyed hash, not an empty/guessable key.
    expect(a).not.toBe(cyrb53(`${hidden}:${salt}`));
    expect(a).not.toBe(await hmacRef(EMPTY_KEY, hidden, salt));
    expect(a).not.toBe(await hmacRef(salt, hidden, salt));
    expect(a).not.toBe(await hmacRef(hidden, hidden, salt));
  });

  test("a different key gives a different ref for the same inputs", async () => {
    const t = convexTest(schema, modules);
    const { viewer, hidden } = await seedHidden(t);
    const before = await refFor(t, viewer, hidden, "thread-9");
    withSecret(OTHER_SECRET);
    const after = await refFor(t, viewer, hidden, "thread-9");
    expect(after).not.toBe(before);
    expect(after).toBe(await hmacRef(OTHER_SECRET, hidden, "thread-9"));
  });

  test("the (targetId, salt) encoding is unambiguous", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      expect(await anonRefOf(ctx, "a:b", "c")).not.toBe(
        await anonRefOf(ctx, "a", "b:c"),
      );
    });
  });

  for (const [label, value] of [
    ["unset", undefined],
    ["too short", "short-secret"],
  ] as const) {
    test(`a ${label} secret fails closed: no throw, an unreproducible ref, stable within one call, loud log`, async () => {
      const t = convexTest(schema, modules);
      const { viewer, hidden } = await seedHidden(t);
      const salt = "copy-1";
      withSecret(value);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});

      const [first, again, otherSalt] = await t.run(async (ctx) => [
        await anonRefOf(ctx, hidden, salt),
        await anonRefOf(ctx, hidden, salt),
        await anonRefOf(ctx, hidden, "copy-2"),
      ]);
      // Stable within one request, still salted.
      expect(again).toBe(first);
      expect(otherSalt).not.toBe(first);
      // Never a guessable fallback.
      expect(first).not.toBe(cyrb53(`${hidden}:${salt}`));
      expect(first).not.toBe(await hmacRef(EMPTY_KEY, hidden, salt));
      expect(first).not.toBe(await hmacRef(value ?? "undefined", hidden, salt));
      expect(first).not.toBe(await hmacRef(TEST_SECRET, hidden, salt));
      // A throwaway key per request: a second request can't be linked to the first.
      expect(await refFor(t, viewer, hidden, salt)).not.toBe(first);

      // Loud, once per request, naming the variable and never echoing its value.
      expect(errors).toHaveBeenCalledTimes(2);
      const message = String(errors.mock.calls[0]?.[0]);
      expect(message).toContain("ANON_REF_SECRET");
      if (value) expect(message).not.toContain(value);
    });
  }
});
