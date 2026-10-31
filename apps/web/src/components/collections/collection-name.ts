import { convexErrorCode } from "@/components/exchange/request-trade";

// Whether createCollection / updateCollection refused the name because the member already has a
// collection with it (the domain's DuplicateCollectionName).
export function isDuplicateCollectionName(error: unknown): boolean {
  return convexErrorCode(error) === "DuplicateCollectionName";
}
