import { toId } from "../../../shared-kernel";
import { CollectionId, CopyId, PersonalCategoryId } from "../../domain";
import {
  CollectionIdGenerator,
  CopyIdGenerator,
  PersonalCategoryIdGenerator,
} from "../ports/out/id-generators";

// Deterministic id generators for tests: copy-1, collection-1, category-1, ...
export class SequentialCopyIdGenerator implements CopyIdGenerator {
  private counter = 0;

  next(): CopyId {
    this.counter += 1;
    return toId<"CopyId">(`copy-${this.counter}`);
  }
}

export class SequentialCollectionIdGenerator implements CollectionIdGenerator {
  private counter = 0;

  next(): CollectionId {
    this.counter += 1;
    return toId<"CollectionId">(`collection-${this.counter}`);
  }
}

export class SequentialPersonalCategoryIdGenerator implements PersonalCategoryIdGenerator {
  private counter = 0;

  next(): PersonalCategoryId {
    this.counter += 1;
    return toId<"PersonalCategoryId">(`category-${this.counter}`);
  }
}
