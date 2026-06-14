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
