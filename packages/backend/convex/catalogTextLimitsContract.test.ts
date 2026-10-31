import {
  MAX_CATALOG_TAGS as CONTRACT_MAX_TAGS,
  CATALOG_TEXT_LIMITS as CONTRACT_TEXT_LIMITS,
} from "@jigswap/contracts";
import { CATALOG_TEXT_LIMITS, MAX_CATALOG_TAGS } from "@jigswap/domain";
import { describe, expect, test } from "vitest";

// The web's catalogue forms take their maxLength and tag bounds from @jigswap/contracts, while
// the domain refuses longer text with TextTooLong (SEC-26). The two copies must agree, or a form
// would accept text the server refuses.
describe("catalogue text limits contract", () => {
  test("the contract's limits are the domain's", () => {
    expect(CONTRACT_TEXT_LIMITS).toEqual(CATALOG_TEXT_LIMITS);
    expect(CONTRACT_MAX_TAGS).toBe(MAX_CATALOG_TAGS);
  });
});
