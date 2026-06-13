import {
  err,
  ok,
  StorePageFetchError,
  type JsonLdProduct,
  type RawProductPage,
  type StorePageFetcher,
} from "@jigswap/domain";
import { extract } from "ogie";

// NOTE on ogie's real type shape (confirmed from ogie@2.1.0 dist/types-Cf4MiUzI.d.mts):
//   result.data.og.images is OpenGraphImage[] (non-optional, always present)
//   result.data.basic is BasicMetaData
//   result.data.jsonLd is JsonLdData | undefined, where JsonLdData = { items: JsonLdItem[]; raw: unknown[] }
//   result.error is OgieError with .code: "FETCH_ERROR"|"TIMEOUT"|"PARSE_ERROR"|"INVALID_URL"|"NO_HTML"|"REDIRECT_LIMIT"
//
// The plan assumed data.jsonLd was a raw array; it is actually { items, raw }. We use data.jsonLd.raw
// so we can filter by @type = "Product" ourselves (the parsed items[] loses the @type discriminant).

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];

// JSON-LD `image` is wildly inconsistent: a string, an array, or an ImageObject ({ url }).
const extractJsonLdImage = (image: unknown): string | string[] | undefined => {
  const one = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { url?: unknown }).url === "string"
    ) {
      return (value as { url: string }).url;
    }
    return null;
  };
  if (Array.isArray(image)) {
    const urls = image.map(one).filter((u): u is string => u !== null);
    return urls.length > 0 ? urls : undefined;
  }
  return one(image) ?? undefined;
};

const flattenBrand = (brand: unknown): string | undefined => {
  if (typeof brand === "string") return brand;
  if (brand && typeof brand === "object" && "name" in brand) {
    const name = (brand as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
};

// Pull every JSON-LD node whose @type is (or includes) "Product" and project the fields we use.
const toJsonLdProducts = (jsonLd: unknown): JsonLdProduct[] => {
  // jsonLd is JsonLdData = { items: JsonLdItem[]; raw: unknown[] } — use .raw for @type filtering
  const rawArray =
    jsonLd != null && typeof jsonLd === "object" && "raw" in jsonLd
      ? asArray((jsonLd as { raw: unknown }).raw)
      : asArray(jsonLd);

  const nodes = asArray(rawArray)
    .flatMap((node) => (Array.isArray(node) ? node : [node])) // unwrap top-level arrays
    .flatMap((node) => {
      const graph = (node as { "@graph"?: unknown })?.["@graph"];
      return graph ? asArray(graph) : [node];
    });

  return nodes
    .filter((node): node is Record<string, unknown> => {
      const type = (node as { "@type"?: unknown })?.["@type"];
      return asArray(type).includes("Product");
    })
    .map((node) => ({
      name: typeof node.name === "string" ? node.name : undefined,
      brand: flattenBrand(node.brand),
      description:
        typeof node.description === "string" ? node.description : undefined,
      image: extractJsonLdImage(node.image),
      gtin13: typeof node.gtin13 === "string" ? node.gtin13 : undefined,
      gtin12: typeof node.gtin12 === "string" ? node.gtin12 : undefined,
      gtin: typeof node.gtin === "string" ? node.gtin : undefined,
    }));
};

// Map ogie ErrorCode to domain StorePageFetchError.
// ogie codes: FETCH_ERROR | TIMEOUT | PARSE_ERROR | INVALID_URL | NO_HTML | REDIRECT_LIMIT
// result.error is always defined on ExtractFailure (non-optional in ogie types), so no ?. needed.
const mapError = (code: string, url: string): StorePageFetchError => {
  switch (code) {
    case "INVALID_URL":
      return StorePageFetchError.invalidUrl(url);
    case "TIMEOUT":
      return StorePageFetchError.timeout(url);
    case "PARSE_ERROR":
    case "NO_HTML":
      return StorePageFetchError.unparseable(url);
    case "REDIRECT_LIMIT":
      return StorePageFetchError.fetchFailed("Too many redirects");
    case "FETCH_ERROR":
    default:
      return StorePageFetchError.fetchFailed(code);
  }
};

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
      return err(
        StorePageFetchError.fetchFailed(
          e instanceof Error ? e.message : String(e),
        ),
      );
    }

    if (!result.success) {
      return err(mapError(result.error.code, url));
    }

    const data = result.data;

    const page: RawProductPage = {
      ogTitle: data.og?.title,
      ogDescription: data.og?.description,
      // og.images is OpenGraphImage[] (always present, each has .url: string)
      ogImages: (data.og?.images ?? [])
        .map((img) => img?.url)
        .filter((u): u is string => typeof u === "string"),
      basicTitle: data.basic?.title,
      basicDescription: data.basic?.description,
      // data.jsonLd is JsonLdData | undefined = { items: JsonLdItem[]; raw: unknown[] }
      jsonLdProducts: toJsonLdProducts(data.jsonLd),
    };
    return ok(page);
  },
};
