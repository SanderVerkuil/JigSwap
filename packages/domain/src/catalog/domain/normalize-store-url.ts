// packages/domain/src/catalog/domain/normalize-store-url.ts

// Cache key normalizer: same product link pasted twice (differing case, fragment, or tracking
// params) maps to one key. Throws if the input is not a parseable URL.
const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|mc_eid$|_ga$|ref$)/i;

export const normalizeStoreUrl = (input: string): string => {
  // The WHATWG URL parser already lowercases the scheme and host, so no manual lowercasing is
  // needed. `input.trim()` still matters: the parser strips ASCII whitespace but not other
  // Unicode whitespace (e.g. a stray NBSP), which would otherwise throw.
  const url = new URL(input.trim());
  url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }

  // Strip trailing slash(es). For the root path this is a no-op after serialization (an empty
  // path re-serializes to "/"), so no length/endsWith guard is required.
  url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString();
};
