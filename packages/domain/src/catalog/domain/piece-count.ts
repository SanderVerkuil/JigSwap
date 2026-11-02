import { err, ok, Result } from "../../shared-kernel";
import { CatalogError } from "./errors";

// Difficulty and shape are small closed descriptive vocabularies mirroring the `puzzles`
// columns; kept as string unions rather than VOs since they carry no behaviour.
export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type Shape = "rectangular" | "panoramic" | "round" | "shaped";

// The largest side a box or puzzle can have, in its unit. Far beyond any real one: it only keeps
// nonsense off the catalog page.
export const MAX_DIMENSION = 10_000;

// Physical box dimensions. Plain typed field, validated only loosely (positive extents within
// MAX_DIMENSION, checked when written).
export interface Dimensions {
  readonly width: number;
  readonly height: number;
  readonly unit: "cm" | "in";
}

const isSide = (side: number): boolean =>
  Number.isFinite(side) && side > 0 && side <= MAX_DIMENSION;

export const checkDimensions = (
  dimensions: Dimensions | undefined,
): Result<void, CatalogError> =>
  dimensions === undefined ||
  (isSide(dimensions.width) && isSide(dimensions.height))
    ? ok(undefined)
    : err(CatalogError.invalidDimensions());

// The most pieces a puzzle can have. The largest made has a few hundred thousand.
export const MAX_PIECE_COUNT = 1_000_000;

// PieceCount is the numeric descriptive field with a real invariant (a puzzle has a positive whole
// number of pieces, and 1e300 is whole too), so it gets a validating value object.
export class PieceCount {
  private constructor(readonly value: number) {}

  static create(value: number): Result<PieceCount, CatalogError> {
    if (!Number.isInteger(value) || value <= 0 || value > MAX_PIECE_COUNT) {
      return err(CatalogError.invalidPieceCount(value));
    }
    return ok(new PieceCount(value));
  }
}
