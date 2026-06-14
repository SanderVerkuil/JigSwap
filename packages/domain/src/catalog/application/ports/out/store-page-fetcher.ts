import { Result } from "../../../../shared-kernel";
import { RawProductPage, StorePageFetchError } from "../../../domain";

// Fetches a store page and returns scraper-agnostic metadata. The adapter (ogie) owns SSRF
// protection, timeout, and User-Agent for the PAGE fetch.
export interface StorePageFetcher {
  fetch(url: string): Promise<Result<RawProductPage, StorePageFetchError>>;
}
