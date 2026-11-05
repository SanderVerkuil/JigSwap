import { Price } from "./price";

// How a Copy entered the owner's library, matching the persisted `ownedPuzzles`
// acquisition columns (acquisitionDate / acquisitionSource) plus an optional paid price.
export type AcquisitionSource = "bought_new" | "bought_used" | "trade" | "gift";

const EARLIEST_ACQUISITION = Date.UTC(1900, 0, 1);
const LATEST_ACQUISITION_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

// A date a copy can have been acquired on: a real date from 1900 on, and at most a year ahead, so
// every month of the current year (all of them are in the Edit dialog's month picker) is fine. An
// impossible one must never be stored: formatting it back throws, in every client that reads it.
export const isPossibleAcquisitionDate = (date: Date, now: Date): boolean => {
  const at = date.getTime();
  return (
    at >= EARLIEST_ACQUISITION &&
    at <= now.getTime() + LATEST_ACQUISITION_AHEAD_MS
  );
};

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
