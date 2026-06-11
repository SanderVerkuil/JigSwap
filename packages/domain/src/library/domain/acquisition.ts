import { Price } from "./price";

// How a Copy entered the owner's library, matching the persisted `ownedPuzzles`
// acquisition columns (acquisitionDate / acquisitionSource) plus an optional paid price.
export type AcquisitionSource = "bought_new" | "bought_used" | "trade" | "gift";

// Value object: all fields optional because acquisition history is frequently unknown.
export class Acquisition {
  private constructor(
    readonly date?: Date,
    readonly source?: AcquisitionSource,
    readonly price?: Price,
  ) {}

  static create(
    props: {
      readonly date?: Date;
      readonly source?: AcquisitionSource;
      readonly price?: Price;
    } = {},
  ): Acquisition {
    return new Acquisition(props.date, props.source, props.price);
  }

  // The empty acquisition (everything unknown) — the default for a freshly minted Copy.
  static unknown(): Acquisition {
    return new Acquisition();
  }
}
