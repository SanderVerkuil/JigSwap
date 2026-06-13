// packages/domain/src/catalog/domain/store-page-fetch-error.ts
import { DomainError } from "../../shared-kernel";

// Why a store page could not be turned into a draft. `code` is the stable, machine-readable
// discriminant transport/UI maps to; the message is for logs/tests only.
export type StorePageFetchErrorCode =
  | "InvalidUrl"
  | "Blocked"
  | "Timeout"
  | "NotFound"
  | "FetchFailed"
  | "Unparseable";

export class StorePageFetchError extends DomainError {
  override readonly name = "StorePageFetchError";

  private constructor(
    readonly code: StorePageFetchErrorCode,
    message: string,
  ) {
    super(message);
  }

  static invalidUrl(url: string): StorePageFetchError {
    return new StorePageFetchError("InvalidUrl", `Not a valid URL: ${url}`);
  }
  static blocked(url: string): StorePageFetchError {
    return new StorePageFetchError(
      "Blocked",
      `Refused to fetch (blocked address): ${url}`,
    );
  }
  static timeout(url: string): StorePageFetchError {
    return new StorePageFetchError("Timeout", `Timed out fetching ${url}`);
  }
  static notFound(url: string): StorePageFetchError {
    return new StorePageFetchError("NotFound", `Page not found: ${url}`);
  }
  static fetchFailed(message: string): StorePageFetchError {
    return new StorePageFetchError("FetchFailed", `Fetch failed: ${message}`);
  }
  static unparseable(url: string): StorePageFetchError {
    return new StorePageFetchError(
      "Unparseable",
      `Could not parse metadata from ${url}`,
    );
  }
}
