// packages/domain/src/catalog/domain/is-private-ip.ts

// SSRF guard for raw image fetches (the page fetch is guarded by ogie). Given a resolved IP
// literal, returns true if it points at loopback / private / link-local / unspecified space.
const ipv4Private = (ip: string): boolean => {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 127) return true; // unspecified, loopback
  if (a === 10) return true; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local
  return false;
};

const ipv6Private = (raw: string): boolean => {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "::" || ip === "::1") return true; // unspecified, loopback
  if (ip.startsWith("fe80")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // fc00::/7 unique-local
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4Private(mapped[1]);
  return false;
};

export const isPrivateIp = (ip: string): boolean =>
  ip.includes(":") ? ipv6Private(ip) : ipv4Private(ip);
