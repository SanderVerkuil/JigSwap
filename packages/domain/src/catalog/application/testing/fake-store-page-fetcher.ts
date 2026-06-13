import { err, ok, Result } from "../../../shared-kernel";
import { RawProductPage, StorePageFetchError } from "../../domain";
import { StorePageFetcher } from "../ports/out/store-page-fetcher";

export class FakeStorePageFetcher implements StorePageFetcher {
  public calls: string[] = [];
  private result: Result<RawProductPage, StorePageFetchError> = ok({
    ogImages: [],
    jsonLdProducts: [],
  });

  seedPage(page: RawProductPage): void {
    this.result = ok(page);
  }
  seedError(error: StorePageFetchError): void {
    this.result = err(error);
  }

  async fetch(url: string): Promise<Result<RawProductPage, StorePageFetchError>> {
    this.calls.push(url);
    return this.result;
  }
}
