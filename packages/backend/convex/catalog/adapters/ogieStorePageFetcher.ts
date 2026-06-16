import {
  err,
  ok,
  StorePageFetchError,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extract } from "ogie";
import { mapOgieError, toRawProductPage } from "./ogieRawProductPage";

export const ogieStorePageFetcher: StorePageFetcher = {
  async fetch(url) {
    let result;
    try {
      result = await extract(url, {
        timeout: 10000,
        userAgent: "JigSwapBot/1.0",
        // SSRF: this primary tier does NOT follow redirects. ogie fetches the entry URL once
        // (maxRedirects:1 means "fetch entry, follow zero hops" — its loop runs exactly once and
        // any 3xx surfaces as a REDIRECT_LIMIT error; note maxRedirects:0 would make ogie fetch
        // NOTHING and always throw, so 1 is the correct "no-follow" value). REDIRECT_LIMIT maps to
        // a retryable FetchFailed, so a redirecting store URL falls through to the fallback chain
        // (browserStorePageFetcher), which DNS-validates EVERY hop. Redirect-following — and its
        // SSRF validation — is therefore handled exclusively by the browser tier, closing the
        // DNS-rebinding-on-redirect gap that following redirects here would have left open.
        // allowPrivateUrls:false is still pinned so the entry URL's literal-private check throws
        // before any egress, defending against a literal private/loopback/link-local entry URL.
        maxRedirects: 1,
        allowPrivateUrls: false,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const detail = e instanceof Error && e.stack ? e.stack : message;
      return err(StorePageFetchError.fetchFailed(message, detail));
    }

    if (!result.success) {
      return err(mapOgieError(result.error, url));
    }

    return ok({ ...toRawProductPage(result.data), source: "ogie" });
  },
};
