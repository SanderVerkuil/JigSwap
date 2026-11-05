// packages/domain/src/catalog/domain/is-private-ip.spec.ts
import { describe, expect, it } from "vitest";
import { isPrivateIp } from "./is-private-ip";

// isPrivateIp is an allowlist: only a globally routable unicast address is "not private". Each
// non-public range is checked at both bounds, and its neighbours just outside are checked to stay
// public (a neighbour is left out where it falls in another non-public range).

describe("isPrivateIp: IPv4 special-purpose ranges", () => {
  const ranges: ReadonlyArray<{
    range: string;
    bounds: readonly [string, string];
    neighbours: readonly string[];
  }> = [
    {
      range: "0.0.0.0/8 this network",
      bounds: ["0.0.0.0", "0.255.255.255"],
      neighbours: ["1.0.0.0"],
    },
    {
      range: "10.0.0.0/8 private",
      bounds: ["10.0.0.0", "10.255.255.255"],
      neighbours: ["9.255.255.255", "11.0.0.0"],
    },
    {
      range: "100.64.0.0/10 shared address space (CGNAT)",
      bounds: ["100.64.0.0", "100.127.255.255"],
      neighbours: ["100.63.255.255", "100.128.0.0"],
    },
    {
      range: "127.0.0.0/8 loopback",
      bounds: ["127.0.0.0", "127.255.255.255"],
      neighbours: ["126.255.255.255", "128.0.0.0"],
    },
    {
      range: "169.254.0.0/16 link-local (cloud metadata)",
      bounds: ["169.254.0.0", "169.254.255.255"],
      neighbours: ["169.253.255.255", "169.255.0.0"],
    },
    {
      range: "172.16.0.0/12 private",
      bounds: ["172.16.0.0", "172.31.255.255"],
      neighbours: ["172.15.255.255", "172.32.0.0"],
    },
    {
      range: "192.0.0.0/24 IETF protocol assignments",
      bounds: ["192.0.0.0", "192.0.0.255"],
      neighbours: ["191.255.255.255", "192.0.1.0"],
    },
    {
      range: "192.0.2.0/24 TEST-NET-1",
      bounds: ["192.0.2.0", "192.0.2.255"],
      neighbours: ["192.0.1.255", "192.0.3.0"],
    },
    {
      range: "192.31.196.0/24 AS112-v4",
      bounds: ["192.31.196.0", "192.31.196.255"],
      neighbours: ["192.31.195.255", "192.31.197.0"],
    },
    {
      range: "192.52.193.0/24 AMT",
      bounds: ["192.52.193.0", "192.52.193.255"],
      neighbours: ["192.52.192.255", "192.52.194.0"],
    },
    {
      range: "192.88.99.0/24 6to4 relay anycast",
      bounds: ["192.88.99.0", "192.88.99.255"],
      neighbours: ["192.88.98.255", "192.88.100.0"],
    },
    {
      range: "192.168.0.0/16 private",
      bounds: ["192.168.0.0", "192.168.255.255"],
      neighbours: ["192.167.255.255", "192.169.0.0"],
    },
    {
      range: "192.175.48.0/24 AS112 direct delegation",
      bounds: ["192.175.48.0", "192.175.48.255"],
      neighbours: ["192.175.47.255", "192.175.49.0"],
    },
    {
      range: "198.18.0.0/15 benchmarking",
      bounds: ["198.18.0.0", "198.19.255.255"],
      neighbours: ["198.17.255.255", "198.20.0.0"],
    },
    {
      range: "198.51.100.0/24 TEST-NET-2",
      bounds: ["198.51.100.0", "198.51.100.255"],
      neighbours: ["198.51.99.255", "198.51.101.0"],
    },
    {
      range: "203.0.113.0/24 TEST-NET-3",
      bounds: ["203.0.113.0", "203.0.113.255"],
      neighbours: ["203.0.112.255", "203.0.114.0"],
    },
    {
      // The upper neighbour, 240.0.0.0, is itself reserved (next row).
      range: "224.0.0.0/4 multicast",
      bounds: ["224.0.0.0", "239.255.255.255"],
      neighbours: ["223.255.255.255"],
    },
    {
      // The lower neighbour is multicast (previous row); there is no upper neighbour.
      range: "240.0.0.0/4 reserved, including broadcast",
      bounds: ["240.0.0.0", "255.255.255.255"],
      neighbours: [],
    },
  ];

  for (const { range, bounds, neighbours } of ranges) {
    it(`flags ${range} at both bounds and leaves its neighbours public`, () => {
      for (const ip of bounds) expect(isPrivateIp(ip), ip).toBe(true);
      for (const ip of neighbours) expect(isPrivateIp(ip), ip).toBe(false);
    });
  }

  it("treats ordinary public IPv4 as public", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "151.101.1.69"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("isPrivateIp: IPv6", () => {
  it("treats global unicast (2000::/3) as public at both bounds", () => {
    for (const ip of [
      "2000::",
      "2606:4700:4700::1111",
      "2a00:1450:4001:80b::200e",
      "3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("flags the addresses just outside 2000::/3", () => {
    expect(isPrivateIp("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    expect(isPrivateIp("4000::")).toBe(true);
  });

  const excluded: ReadonlyArray<{
    range: string;
    bounds: readonly [string, string];
    neighbours: readonly [string, string];
  }> = [
    {
      range: "2001::/23 IETF protocol assignments (Teredo, benchmarking)",
      bounds: ["2001::", "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff"],
      neighbours: ["2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "2001:200::"],
    },
    {
      range: "2001:db8::/32 documentation",
      bounds: ["2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"],
      neighbours: ["2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db9::"],
    },
    {
      range: "2002::/16 6to4",
      bounds: ["2002::", "2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
      neighbours: ["2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "2003::"],
    },
    {
      range: "3fff::/20 documentation",
      bounds: ["3fff::", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff"],
      neighbours: ["3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "3fff:1000::"],
    },
  ];

  for (const { range, bounds, neighbours } of excluded) {
    it(`flags ${range} at both bounds and leaves its neighbours public`, () => {
      for (const ip of bounds) expect(isPrivateIp(ip), ip).toBe(true);
      for (const ip of neighbours) expect(isPrivateIp(ip), ip).toBe(false);
    });
  }

  it("flags the special-purpose space outside 2000::/3", () => {
    for (const ip of [
      "::", // unspecified
      "::1", // loopback
      "::8.8.8.8", // IPv4-compatible (::/96), even with a public IPv4 inside
      "::ffff:0:8.8.8.8", // SIIT (::ffff:0:0:0/96)
      "64:ff9b::8.8.8.8", // NAT64 well-known prefix (64:ff9b::/96)
      "64:ff9b:1::808:808", // NAT64 local-use (64:ff9b:1::/48)
      "100::1", // discard-only (100::/64)
      "fc00::", // unique local (fc00::/7), both ends
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::1", // link-local (fe80::/10), both ends
      "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fec0::1", // site-local (fec0::/10, deprecated)
      "ff02::1", // multicast (ff00::/8)
      "ff0e::101",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("unwraps IPv4-mapped addresses (::ffff:0:0/96) to the IPv4 rule", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:808:808")).toBe(false);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:198.18.0.1")).toBe(true);
    expect(isPrivateIp("0:0:0:0:0:ffff:c0a8:101")).toBe(true); // 192.168.1.1
  });

  it("accepts the textual forms DNS answers and URLs produce", () => {
    expect(isPrivateIp("2606:4700:4700:0:0:0:0:1111")).toBe(false); // no ::
    expect(isPrivateIp("2606:4700:4700:0000:0000:0000:0000:1111")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111".toUpperCase())).toBe(false);
    expect(isPrivateIp("[2606:4700:4700::1111]")).toBe(false); // URL brackets
    expect(isPrivateIp("[::1]")).toBe(true);
    expect(isPrivateIp("fe80::1%eth0")).toBe(true); // zone id
    expect(isPrivateIp("2606:4700:4700::1111%en0")).toBe(false);
    expect(isPrivateIp("2001:4860::1.2.3.4")).toBe(false); // dotted tail
    expect(isPrivateIp("1:2:3:4:5:6:7::")).toBe(true); // outside 2000::/3
  });
});

describe("isPrivateIp fails closed", () => {
  // Anything that is not a well-formed IP literal counts as non-public, so a parser surprise can
  // never open the SSRF guard.
  it("treats malformed IPv4 as non-public", () => {
    for (const ip of [
      "",
      "not-an-ip",
      "8",
      "8.8",
      "8.8.8",
      "8.8.8.8.8",
      "8.8.8.256",
      "8.8.8.-1",
      "8.8.8.x",
      "08.8.8.8", // leading zero: some parsers read it as octal
      "8.8.8.010",
      " 8.8.8.8",
      "8.8.8.8 ",
      "0x8.8.8.8",
      "134744072", // 8.8.8.8 as one number
    ]) {
      expect(isPrivateIp(ip), JSON.stringify(ip)).toBe(true);
    }
  });

  it("treats malformed IPv6 as non-public", () => {
    for (const ip of [
      ":",
      ":::",
      "2606:4700:4700::1111::",
      "2606::4700::1111",
      "1:2:3:4:5:6:7:8:9",
      "2001:4860:1:2:3:4:5", // seven groups, no ::
      "2606:4700:4700:0:0:0:0:0:1111", // nine groups
      "2001:1:2:3:4:5:6:7::", // :: next to eight explicit groups
      "2606:4700::12345",
      "2606:4700::g",
      ":2606:4700::1",
      "2606:4700::1:",
      "[2606:4700::1", // unbalanced brackets
      "2606:4700::1]",
      "[[2606:4700::1]]",
      "2606:4700::1%", // empty zone
      "2001:4860::1.2.3", // short dotted tail
      "2001:4860::8.8.8.256",
      "2001:4860::08.8.8.8",
      "8.8.8.8::", // dotted quad not at the end
      "2001:4860:8.8.8.8::1",
      "2001:4860::8.8.8.8:1",
    ]) {
      expect(isPrivateIp(ip), JSON.stringify(ip)).toBe(true);
    }
  });
});
