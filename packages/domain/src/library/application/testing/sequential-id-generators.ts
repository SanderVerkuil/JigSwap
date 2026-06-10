import {
  toCollectionId,
  toCopyId,
  toLoanId,
  toPersonalCategoryId,
} from "../../../shared-kernel";
import { CollectionId, CopyId, LoanId, PersonalCategoryId } from "../../domain";
import {
  CollectionIdGenerator,
  CopyIdGenerator,
  LoanIdGenerator,
  PersonalCategoryIdGenerator,
} from "../ports/out/id-generators";

// Deterministic id generators for tests: copy-1, collection-1, category-1, ...
export class SequentialCopyIdGenerator implements CopyIdGenerator {
  private counter = 0;

  next(): CopyId {
    this.counter += 1;
    return toCopyId(`copy-${this.counter}`);
  }
}

export class SequentialCollectionIdGenerator implements CollectionIdGenerator {
  private counter = 0;

  next(): CollectionId {
    this.counter += 1;
    return toCollectionId(`collection-${this.counter}`);
  }
}

export class SequentialPersonalCategoryIdGenerator implements PersonalCategoryIdGenerator {
  private counter = 0;

  next(): PersonalCategoryId {
    this.counter += 1;
    return toPersonalCategoryId(`category-${this.counter}`);
  }
}

export class SequentialLoanIdGenerator implements LoanIdGenerator {
  private counter = 0;

  next(): LoanId {
    this.counter += 1;
    return toLoanId(`loan-${this.counter}`);
  }
}
