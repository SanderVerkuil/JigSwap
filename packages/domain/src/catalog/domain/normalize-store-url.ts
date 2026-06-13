// packages/domain/src/catalog/domain/normalize-store-url.ts

// Cache key normalizer: same product link pasted twice (differing case, fragment, or tracking
// params) maps to one key. Throws if the input is not a parseable URL.
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|mc_eid$|_ga$|ref$)/i;

export const normalizeStoreUrl = (input: string): string => {
  const url = new URL(input.trim());
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
};
