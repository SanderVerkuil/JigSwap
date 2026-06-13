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

  // `detail` carries the underlying, low-level cause (e.g. the scraper's raw error code/message)
  // for diagnostics/logging. It is never shown to users — the UI keys on `code`.
  private constructor(
    readonly code: StorePageFetchErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }

  static invalidUrl(url: string, detail?: string): StorePageFetchError {
    return new StorePageFetchError(
      "InvalidUrl",
      `Not a valid URL: ${url}`,
      detail,
    );
  }
  static blocked(url: string, detail?: string): StorePageFetchError {
    return new StorePageFetchError(
      "Blocked",
      `Refused to fetch (blocked address): ${url}`,
      detail,
    );
  }
  static timeout(url: string, detail?: string): StorePageFetchError {
    return new StorePageFetchError(
      "Timeout",
      `Timed out fetching ${url}`,
      detail,
    );
  }
  static notFound(url: string, detail?: string): StorePageFetchError {
    return new StorePageFetchError(
      "NotFound",
      `Page not found: ${url}`,
      detail,
    );
  }
  static fetchFailed(message: string, detail?: string): StorePageFetchError {
    return new StorePageFetchError(
      "FetchFailed",
      `Fetch failed: ${message}`,
      detail ?? message,
    );
  }
  static unparseable(url: string, detail?: string): StorePageFetchError {
    return new StorePageFetchError(
      "Unparseable",
      `Could not parse metadata from ${url}`,
      detail,
    );
  }
}
