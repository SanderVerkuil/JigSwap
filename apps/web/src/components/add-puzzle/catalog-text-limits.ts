// The catalogue's text bounds, from @jigswap/contracts, which a backend test keeps equal to the
// domain's (the server refuses longer text with TextTooLong). The forms use them as maxLength so
// a member never types what the server refuses. Re-exported here so the forms keep one import.
export { CATALOG_TEXT_LIMITS, MAX_CATALOG_TAGS } from "@jigswap/contracts";
