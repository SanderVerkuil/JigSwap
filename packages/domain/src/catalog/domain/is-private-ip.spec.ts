// packages/domain/src/catalog/domain/is-private-ip.spec.ts
import { describe, expect, it } from "vitest";
import { isPrivateIp } from "./is-private-ip";

describe("isPrivateIp", () => {
  it("flags loopback, RFC-1918, link-local, and unspecified IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.10.10",
      "0.0.0.0",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags IPv6 loopback, ULA, and link-local", () => {
    for (const ip of ["::1", "fc00::1", "fd12::34", "fe80::1", "::"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("flags link-local across the full fe80::/10 range", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("feb0::1")).toBe(true);
    expect(isPrivateIp("febf::1")).toBe(true);
  });

  it("flags IPv4-mapped private addresses in hex-colon form", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8
  });

  it("allows public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  // --- IPv4 part-count validation (L8: parts.length !== 4) ---
  // A malformed-but-private-looking address with too few/too many octets must
  // NOT be treated as a valid IPv4 and so must return false. If the length
  // guard is dropped (mutated to false / always passes), "10" alone would be
  // parsed as a===10 and wrongly flagged private.
  it("rejects IPv4 with fewer than four octets even when first octet is private", () => {
    expect(isPrivateIp("10")).toBe(false);
    expect(isPrivateIp("10.0")).toBe(false);
    expect(isPrivateIp("10.0.0")).toBe(false);
  });

  it("rejects IPv4 with more than four octets even when first octet is private", () => {
    expect(isPrivateIp("10.0.0.0.0")).toBe(false);
  });

  // --- IPv4 octet validation predicate (L9: parts.some(... range/integer)) ---
  // The `.some` must short-circuit on ANY invalid octet. If mutated to `.every`,
  // a single bad octet (here the 4th) would no longer invalidate the address.
  it("rejects IPv4 when only one octet is non-integer (some, not every)", () => {
    expect(isPrivateIp("10.0.0.x")).toBe(false);
  });

  // n > 255 branch: a private-prefixed address with one out-of-range octet
  // must be rejected. Distinguishes `n > 255` from a dropped/false predicate.
  it("rejects IPv4 with an octet above 255", () => {
    expect(isPrivateIp("10.0.0.256")).toBe(false);
  });

  // n < 0 branch: a negative octet must reject. parseInt("-5") = -5.
  it("rejects IPv4 with a negative octet", () => {
    expect(isPrivateIp("10.0.0.-5")).toBe(false);
  });

  // !Number.isInteger branch: NaN octet (non-numeric) must reject.
  it("rejects IPv4 with a NaN octet", () => {
    expect(isPrivateIp("10.0.0.abc")).toBe(false);
  });

  // Confirms the predicate accepts the legal boundaries 0 and 255 (so the
  // range check is `< 0`/`> 255`, not `<= 0`/`>= 255`).
  it("accepts boundary octet values 0 and 255 within a private range", () => {
    expect(isPrivateIp("10.0.0.255")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  // --- 172.16.0.0/12 boundaries (L16: a===172 && b>=16 && b<=31) ---
  it("flags the exact lower and upper bounds of 172.16/12", () => {
    expect(isPrivateIp("172.16.0.0")).toBe(true); // b === 16 lower bound
    expect(isPrivateIp("172.31.255.255")).toBe(true); // b === 31 upper bound
  });

  it("allows 172 addresses just outside the /12 block (b=15 and b=32)", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false); // one below lower bound
    expect(isPrivateIp("172.32.0.1")).toBe(false); // one above upper bound
  });

  // Distinguishes `a===172 && b>=16` from `a===172 || b>=16`: a public first
  // octet combined with b in [16,31] must stay public.
  it("does not flag a public first octet merely because second octet is 16-31", () => {
    expect(isPrivateIp("8.16.0.1")).toBe(false);
    expect(isPrivateIp("8.31.0.1")).toBe(false);
  });

  // --- 192.168.0.0/16 (L17: a===192 && b===168) ---
  it("flags 192.168 and rejects neighbors that share only one octet", () => {
    expect(isPrivateIp("192.168.0.0")).toBe(true);
    expect(isPrivateIp("192.167.0.1")).toBe(false); // b one below
    expect(isPrivateIp("192.169.0.1")).toBe(false); // b one above
    expect(isPrivateIp("191.168.0.1")).toBe(false); // a one below
    expect(isPrivateIp("193.168.0.1")).toBe(false); // a one above
  });

  // --- 169.254.0.0/16 link-local (L18: a===169 && b===254) ---
  it("flags 169.254 link-local and rejects neighbors sharing only one octet", () => {
    expect(isPrivateIp("169.254.0.0")).toBe(true);
    expect(isPrivateIp("169.253.0.1")).toBe(false); // b one below
    expect(isPrivateIp("169.255.0.1")).toBe(false); // b one above
    expect(isPrivateIp("168.254.0.1")).toBe(false); // a one below
    expect(isPrivateIp("170.254.0.1")).toBe(false); // a one above
  });

  // --- IPv6 bracket stripping (L23: replace(/^\[|\]$/g, "")) ---
  // Bracketed forms must be normalized so the inner address is classified.
  it("strips surrounding brackets from IPv6 literals", () => {
    expect(isPrivateIp("[::1]")).toBe(true);
    expect(isPrivateIp("[fe80::1]")).toBe(true);
    expect(isPrivateIp("[2606:4700:4700::1111]")).toBe(false);
  });

  // The `^\[` anchor: a stray '[' that is NOT leading must remain, so an
  // address with an internal bracket is not silently cleaned into "::1".
  // ":a[:1" contains a colon (routed to IPv6) but is not a private form;
  // if the leading-anchor were dropped the '[' would be stripped anywhere.
  it("only strips a leading bracket, not internal brackets", () => {
    // "::1]" -> with trailing-anchor strip becomes "::1" (private).
    expect(isPrivateIp("::1]")).toBe(true);
    // A non-leading '[' must not be removed; "::[1" stays non-loopback.
    expect(isPrivateIp("::[1")).toBe(false);
  });

  // The `\]$` anchor: a trailing ']' is stripped, but a non-trailing ']' is not.
  it("only strips a trailing bracket, not internal ones", () => {
    expect(isPrivateIp("[::1")).toBe(true); // leading '[' stripped -> "::1"
    expect(isPrivateIp("::]1")).toBe(false); // internal ']' kept -> not loopback
  });

  // The replacement string must be "" (empty). If mutated to a non-empty
  // literal, "[::1]" would become e.g. "Stryker...::1Stryker..." and not match.
  it("replaces brackets with empty string so the inner literal matches exactly", () => {
    expect(isPrivateIp("[::]")).toBe(true); // -> "::" unspecified
  });

  // --- fe80::/10 anchor (L25: /^fe[89ab]/i) ---
  // The `^` anchor matters: "fe8" must only be flagged when it STARTS the
  // address. An address that merely contains "fe8" later must not be flagged.
  it("only flags fe[89ab] when it is the prefix of the IPv6 address", () => {
    expect(isPrivateIp("fe89::1")).toBe(true); // starts with fe89
    expect(isPrivateIp("2606:fe80::1")).toBe(false); // contains but not prefix
  });

  // The character class [89ab]: fe7x and fecx are outside fe80::/10.
  it("does not flag fe7 or fec prefixes as link-local", () => {
    expect(isPrivateIp("fe70::1")).toBe(false);
    expect(isPrivateIp("fec0::1")).toBe(false);
  });

  // --- fc00::/7 ULA anchor (L26: /^f[cd][0-9a-f]{2}:/) ---
  // The `^` anchor: only a leading fc/fd block is ULA.
  it("only flags f[cd]xx: when it is the prefix of the IPv6 address", () => {
    expect(isPrivateIp("fc12::1")).toBe(true);
    expect(isPrivateIp("fd34::1")).toBe(true);
    expect(isPrivateIp("2606:fc12::1")).toBe(false); // contains but not prefix
  });

  // --- IPv4-mapped dotted-decimal (L27: /^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ---
  it("flags IPv4-mapped dotted-decimal private addresses", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows IPv4-mapped dotted-decimal public addresses", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  // The `^` anchor on the dotted-decimal regex: a prefix before ::ffff: must
  // prevent a match (otherwise the embedded private v4 would leak through).
  it("requires the ::ffff: dotted-decimal mapping to start the address", () => {
    expect(isPrivateIp("1234:ffff:127.0.0.1")).toBe(false);
  });

  // The `$` anchor on the dotted-decimal regex: trailing junk must prevent a
  // match. Routed to IPv6 because of the colons; must NOT be flagged private.
  it("requires the ::ffff: dotted-decimal mapping to end the address", () => {
    expect(isPrivateIp("::ffff:127.0.0.1:extra")).toBe(false);
  });

  // The `\d+` (one-or-more) quantifiers: each octet may be multi-digit. A
  // multi-digit-octet private mapping must still be recognized. If any `\d+`
  // were narrowed to a single `\d`, "127" / "168" octets would fail to match.
  it("matches multi-digit octets in each position of the mapped v4 address", () => {
    expect(isPrivateIp("::ffff:127.16.31.254")).toBe(true); // a=127 loopback range
    expect(isPrivateIp("::ffff:192.168.100.200")).toBe(true); // all multi-digit, private
  });

  // The `\d` (digit, not \D) class: a non-digit octet must NOT match the
  // mapped pattern, so it falls through and the address is not private.
  it("does not match the dotted-decimal mapping when an octet is non-numeric", () => {
    expect(isPrivateIp("::ffff:10.x.0.1")).toBe(false);
  });

  // --- L28: if (mapped) return ipv4Private(...) ---
  // Confirms the mapped branch is actually taken: a mapped *private* address
  // returns true (mutating the guard to false would return false here).
  it("returns the embedded v4 classification when a dotted-decimal mapping matches", () => {
    expect(isPrivateIp("::ffff:172.16.5.5")).toBe(true);
  });

  // --- IPv4-mapped hex-colon (L29: /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ---
  it("flags and allows IPv4-mapped hex-colon addresses by embedded v4", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1 private
    expect(isPrivateIp("::ffff:c0a8:0101")).toBe(true); // 192.168.1.1 private
    expect(isPrivateIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8 public
  });

  // The `^` anchor on the hex-colon regex.
  it("requires the ::ffff: hex-colon mapping to start the address", () => {
    expect(isPrivateIp("1234:ffff:7f00:1")).toBe(false);
  });

  // The `$` anchor on the hex-colon regex: trailing group must end the string.
  it("requires the ::ffff: hex-colon mapping to end the address", () => {
    expect(isPrivateIp("::ffff:7f00:0001:dead")).toBe(false);
  });

  // The `{1,4}` quantifier on the final hex group: a full 4-hex-digit group
  // (e.g. "0001") must still match. If narrowed to a single digit, the 127.0.0.1
  // form below ("7f00:0001") would fail to match and fall through to false.
  it("matches up to four hex digits in the final hex-colon group", () => {
    expect(isPrivateIp("::ffff:7f00:0001")).toBe(true); // 127.0.0.1
  });

  // --- Leading `^` anchor on the IPv4-mapped IPv6 patterns ---
  // A "::ffff:" sequence embedded mid-string (not at the start) must NOT be parsed as a mapped
  // address. Without the `^` anchor a mutant would match the substring and mis-classify it.
  it("does not treat a mid-string dotted-decimal mapped address as private (`^` anchor)", () => {
    expect(isPrivateIp("junk::ffff:10.0.0.1")).toBe(false);
  });

  it("does not treat a mid-string hex-colon mapped address as private (`^` anchor)", () => {
    expect(isPrivateIp("junk::ffff:0a00:0001")).toBe(false); // 10.0.0.1 only if loosely matched
  });
});
