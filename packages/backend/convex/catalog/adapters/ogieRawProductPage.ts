import {
  type JsonLdProduct,
  type RawProductPage,
  StorePageFetchError,
} from "@jigswap/domain";

export const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];

// JSON-LD `image` is wildly inconsistent: a string, an array, or an ImageObject ({ url }).
export const extractJsonLdImage = (
  image: unknown,
): string | string[] | undefined => {
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

export const flattenBrand = (brand: unknown): string | undefined => {
  if (typeof brand === "string") return brand;
  if (brand && typeof brand === "object" && "name" in brand) {
    const name = (brand as { name?: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
};

// Pull every JSON-LD node whose @type is (or includes) "Product" and project the fields we use.
export const toJsonLdProducts = (jsonLd: unknown): JsonLdProduct[] => {
  // jsonLd is JsonLdData = { items: JsonLdItem[]; raw: unknown[] } — use .raw for @type filtering
  const rawArray =
    jsonLd != null && typeof jsonLd === "object" && "raw" in jsonLd
      ? asArray((jsonLd as { raw: unknown }).raw)
      : asArray(jsonLd);

  const nodes = asArray(rawArray)
    .flatMap((node) => (Array.isArray(node) ? node : [node]))
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

// Map ogie ErrorCode to domain StorePageFetchError, preserving the raw ogie code+message as
// `detail` so a failed extraction can be diagnosed from the logs (the UI only ever sees `code`).
// ogie codes: FETCH_ERROR | TIMEOUT | PARSE_ERROR | INVALID_URL | NO_HTML | REDIRECT_LIMIT
export const mapOgieError = (
  error: { code: string; message?: string },
  url: string,
): StorePageFetchError => {
  const detail = error.message
    ? `${error.code}: ${error.message}`
    : error.code;
  switch (error.code) {
    case "INVALID_URL":
      return StorePageFetchError.invalidUrl(url, detail);
    case "TIMEOUT":
      return StorePageFetchError.timeout(url, detail);
    case "PARSE_ERROR":
    case "NO_HTML":
      return StorePageFetchError.unparseable(url, detail);
    case "REDIRECT_LIMIT":
      return StorePageFetchError.fetchFailed("Too many redirects", detail);
    case "FETCH_ERROR":
    default:
      return StorePageFetchError.fetchFailed(error.code, detail);
  }
};

// Project the ogie `data` object (from extract or extractFromHtml) into domain RawProductPage.
export const toRawProductPage = (data: {
  og?: {
    title?: string;
    description?: string;
    images?: Array<{ url?: string }>;
  };
  basic?: { title?: string; description?: string };
  jsonLd?: unknown;
}): RawProductPage => ({
  ogTitle: data.og?.title,
  ogDescription: data.og?.description,
  ogImages: (data.og?.images ?? [])
    .map((img) => img?.url)
    .filter((u): u is string => typeof u === "string"),
  basicTitle: data.basic?.title,
  basicDescription: data.basic?.description,
  jsonLdProducts: toJsonLdProducts(data.jsonLd),
});
