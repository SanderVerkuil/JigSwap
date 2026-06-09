import { CollectionId, CopyId, PersonalCategoryId } from "../../../domain";

// Outbound ports: minting new aggregate ids. The aggregates' factories take their id as input
// (they are pure and do no I/O), so the use cases obtain one here. The 2c-convex adapters can
// back these with a pre-inserted document id or a uuid.
export interface CopyIdGenerator {
  next(): CopyId;
}

export interface CollectionIdGenerator {
  next(): CollectionId;
}

export interface PersonalCategoryIdGenerator {
  next(): PersonalCategoryId;
}
