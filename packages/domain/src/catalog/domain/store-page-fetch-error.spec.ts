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
});
