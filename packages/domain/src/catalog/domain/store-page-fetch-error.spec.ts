// packages/domain/src/catalog/domain/store-page-fetch-error.spec.ts
import { describe, expect, it } from "vitest";
import { DomainError } from "../../shared-kernel";
import { StorePageFetchError } from "./store-page-fetch-error";

describe("StorePageFetchError", () => {
  it("carries a stable code discriminant", () => {
    expect(StorePageFetchError.invalidUrl("x").code).toBe("InvalidUrl");
    expect(StorePageFetchError.blocked("x").code).toBe("Blocked");
    expect(StorePageFetchError.timeout("x").code).toBe("Timeout");
    expect(StorePageFetchError.notFound("x").code).toBe("NotFound");
    expect(StorePageFetchError.fetchFailed("boom").code).toBe("FetchFailed");
    expect(StorePageFetchError.unparseable("x").code).toBe("Unparseable");
  });

  it("is an Error subclass", () => {
    expect(StorePageFetchError.timeout("x")).toBeInstanceOf(Error);
    expect(StorePageFetchError.timeout("x")).toBeInstanceOf(DomainError);
  });

  it("carries an optional diagnostic detail (the underlying cause)", () => {
    expect(
      StorePageFetchError.fetchFailed("boom", "FETCH_ERROR: dns fail").detail,
    ).toBe("FETCH_ERROR: dns fail");
    expect(StorePageFetchError.timeout("x", "took 11s").detail).toBe(
      "took 11s",
    );
    // fetchFailed defaults detail to its message when no explicit detail is given
    expect(StorePageFetchError.fetchFailed("boom").detail).toBe("boom");
    // other factories leave detail undefined when not provided
    expect(StorePageFetchError.invalidUrl("x").detail).toBeUndefined();
  });

  it("overrides name to the concrete error type", () => {
    expect(StorePageFetchError.timeout("x").name).toBe("StorePageFetchError");
  });

  // Each factory builds an exact human message that interpolates its argument. Asserting the
  // full string pins both the literal text and that the interpolated value actually appears.
  describe("messages", () => {
    it("invalidUrl interpolates the url", () => {
      expect(StorePageFetchError.invalidUrl("ftp://x").message).toBe(
        "Not a valid URL: ftp://x",
      );
    });

    it("blocked interpolates the url", () => {
      expect(StorePageFetchError.blocked("http://10.0.0.1").message).toBe(
        "Refused to fetch (blocked address): http://10.0.0.1",
      );
    });

    it("timeout interpolates the url", () => {
      expect(StorePageFetchError.timeout("https://slow.example").message).toBe(
        "Timed out fetching https://slow.example",
      );
    });

    it("notFound interpolates the url", () => {
      expect(StorePageFetchError.notFound("https://gone.example").message).toBe(
        "Page not found: https://gone.example",
      );
    });

    it("fetchFailed interpolates the underlying message", () => {
      expect(StorePageFetchError.fetchFailed("dns fail").message).toBe(
        "Fetch failed: dns fail",
      );
    });

    it("unparseable interpolates the url", () => {
      expect(
        StorePageFetchError.unparseable("https://nohead.example").message,
      ).toBe("Could not parse metadata from https://nohead.example");
    });
  });
});
