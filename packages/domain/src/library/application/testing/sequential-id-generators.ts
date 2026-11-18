import { toCollectionId, toCopyId, toLoanId } from "../../../shared-kernel";
import { CollectionId, CopyId, LoanId } from "../../domain";
import {
  CollectionIdGenerator,
  CopyIdGenerator,
  LoanIdGenerator,
} from "../ports/out/id-generators";

// Deterministic id generators for tests: copy-1, collection-1, ...
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

export class SequentialLoanIdGenerator implements LoanIdGenerator {
  private counter = 0;

  next(): LoanId {
    this.counter += 1;
    return toLoanId(`loan-${this.counter}`);
  }
}
