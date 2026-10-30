// packages/domain/src/catalog/domain/is-private-ip.ts

// SSRF guard for every outbound fetch the URL import makes. Given an IP literal (a DNS answer, or
// the host of a URL), returns false ONLY for a globally routable unicast address; everything else
// is "private" in the sense of "never fetch this". It is an allowlist, not a denylist:
//   - IPv4 is public unless it falls in an IANA special-purpose range (IPV4_NON_PUBLIC).
//   - IPv6 is public only inside global unicast 2000::/3, minus the special-purpose blocks inside
//     it (2001::/23, 2001:db8::/32, 2002::/16, 3fff::/20). IPv4-mapped ::ffff:0:0/96 is unwrapped to
//     the IPv4 rule. Loopback, link-local, unique-local, site-local, multicast, NAT64, SIIT,
//     IPv4-compatible and every unassigned prefix sit outside 2000::/3 and so are non-public.
//   - It FAILS CLOSED: anything that is not a well-formed IP literal counts as non-public.

// An IPv4 address as an unsigned 32-bit number, or null. Strict dotted quad only: no shorthand
// ("10.1"), no single integer, and no leading zeros (some parsers read "010" as octal).
const parseIpv4 = (text: string): number | null => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (match === null) return null;
  let value = 0;
  for (const octet of match.slice(1)) {
    if (octet.length > 1 && octet.startsWith("0")) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
};

const ipv4 = (a: number, b: number, c: number, d: number): number =>
  ((a * 256 + b) * 256 + c) * 256 + d;

// IANA IPv4 special-purpose registry, plus multicast and the reserved 240/4 (with broadcast).
const IPV4_NON_PUBLIC: ReadonlyArray<readonly [base: number, bits: number]> = [
  [ipv4(0, 0, 0, 0), 8], // "this network"
  [ipv4(10, 0, 0, 0), 8], // private
  [ipv4(100, 64, 0, 0), 10], // shared address space (carrier-grade NAT)
  [ipv4(127, 0, 0, 0), 8], // loopback
  [ipv4(169, 254, 0, 0), 16], // link-local, including cloud metadata 169.254.169.254
  [ipv4(172, 16, 0, 0), 12], // private
  [ipv4(192, 0, 0, 0), 24], // IETF protocol assignments
  [ipv4(192, 0, 2, 0), 24], // documentation (TEST-NET-1)
  [ipv4(192, 31, 196, 0), 24], // AS112-v4
  [ipv4(192, 52, 193, 0), 24], // AMT
  [ipv4(192, 88, 99, 0), 24], // deprecated 6to4 relay anycast
  [ipv4(192, 168, 0, 0), 16], // private
  [ipv4(192, 175, 48, 0), 24], // AS112 direct delegation
  [ipv4(198, 18, 0, 0), 15], // benchmarking
  [ipv4(198, 51, 100, 0), 24], // documentation (TEST-NET-2)
  [ipv4(203, 0, 113, 0), 24], // documentation (TEST-NET-3)
  [ipv4(224, 0, 0, 0), 4], // multicast
  [ipv4(240, 0, 0, 0), 4], // reserved, including broadcast 255.255.255.255
];

const inIpv4Range = (ip: number, base: number, bits: number): boolean => {
  const size = 2 ** (32 - bits);
  return Math.floor(ip / size) === Math.floor(base / size);
};

const isPublicIpv4 = (ip: number): boolean =>
  !IPV4_NON_PUBLIC.some(([base, bits]) => inIpv4Range(ip, base, bits));

// Hex groups of one side of a "::" split. A dotted-quad tail (two groups) is allowed only as the
// last piece of the whole address.
const parseIpv6Groups = (part: string, allowIpv4Tail: boolean) => {
  if (part === "") return [];
  const pieces = part.split(":");
  const groups: number[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (/^[0-9a-f]{1,4}$/i.test(piece)) {
      groups.push(Number.parseInt(piece, 16));
      continue;
    }
    const tail =
      allowIpv4Tail && index === pieces.length - 1 ? parseIpv4(piece) : null;
    if (tail === null) return null;
    groups.push(Math.floor(tail / 0x10000), tail % 0x10000);
  }
  return groups;
};

// An IPv6 address as eight 16-bit groups, or null. Takes URL brackets ("[::1]"), a zone id
// ("fe80::1%eth0"), "::" compression and a trailing dotted quad ("::ffff:1.2.3.4").
const parseIpv6 = (raw: string): number[] | null => {
  let text = raw;
  if (text.startsWith("[") || text.endsWith("]")) {
    if (!text.startsWith("[") || !text.endsWith("]")) return null;
    text = text.slice(1, -1);
  }
  const zone = text.indexOf("%");
  if (zone !== -1) {
    if (zone === text.length - 1) return null;
    text = text.slice(0, zone);
  }
  const halves = text.split("::");
  if (halves.length === 1) {
    const groups = parseIpv6Groups(text, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  if (halves.length !== 2) return null;
  const head = parseIpv6Groups(halves[0], false);
  const tail = parseIpv6Groups(halves[1], true);
  // "::" stands for at least one zero group.
  if (head === null || tail === null || head.length + tail.length > 7) {
    return null;
  }
  const zeros = new Array<number>(8 - head.length - tail.length).fill(0);
  return [...head, ...zeros, ...tail];
};

const isPublicIpv6 = (groups: readonly number[]): boolean => {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // IPv4-mapped ::ffff:0:0/96: the embedded IPv4 decides.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    return g5 === 0xffff && isPublicIpv4(g6 * 0x10000 + g7);
  }
  if ((g0 & 0xe000) !== 0x2000) return false; // outside global unicast 2000::/3
  if (g0 === 0x2001 && g1 < 0x0200) return false; // 2001::/23 IETF protocol assignments
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g0 === 0x2002) return false; // 2002::/16 6to4
  if (g0 === 0x3fff && g1 < 0x1000) return false; // 3fff::/20 documentation
  return true;
};

const isPublicIp = (ip: string): boolean => {
  if (ip.includes(":")) {
    const groups = parseIpv6(ip);
    return groups !== null && isPublicIpv6(groups);
  }
  const value = parseIpv4(ip);
  return value !== null && isPublicIpv4(value);
};

export const isPrivateIp = (ip: string): boolean => !isPublicIp(ip);
