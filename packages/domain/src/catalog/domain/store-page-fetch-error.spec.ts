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
});
