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
});
