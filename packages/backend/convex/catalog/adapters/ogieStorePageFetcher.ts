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
        maxRedirects: 5,
        // SSRF: ogie fetches with `redirect: "manual"` and re-validates EVERY hop (entry URL and
        // each redirect target) against literal private/loopback/link-local IPs + internal TLDs;
        // it also blocks https->http downgrades. We PIN allowPrivateUrls:false (rather than relying
        // on ogie's default) so a redirect to e.g. http://169.254.169.254/ or http://127.0.0.1/ is
        // rejected by ogie itself — closing the redirect-hop SSRF that this primary tier previously
        // left to chance. (Residual: ogie's per-hop check is LEXICAL, so a public hostname that DNS-
        // resolves to a private IP on a redirect hop is not caught here; that DNS-rebinding case is
        // handled by the DNS-validating browserStorePageFetcher fallback, and the entry URL's DNS is
        // validated up front by assertPublicUrl.)
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
