import { PuzzleDefinition, PuzzleDefinitionChanges } from "../../domain";

// Snapshot the CURRENT value of every field the diff touches, in the same shape as the diff.
// Captured server-side at file/edit time; review UIs later compare it against the then-current
// definition to derive "changed since proposed" markers. Fields the diff does not touch stay
// undefined (indistinguishable from "base value was absent", which is fine: conflict detection
// iterates the CHANGES' defined fields, not the baseline's).
export const baselineFor = (
  definition: PuzzleDefinition,
  changes: PuzzleDefinitionChanges,
): PuzzleDefinitionChanges => {
  const state = definition.toState();
  return {
    title: changes.title !== undefined ? state.title : undefined,
    description:
      changes.description !== undefined ? state.description : undefined,
    brand: changes.brand !== undefined ? state.brand : undefined,
    pieceCount: changes.pieceCount !== undefined ? state.pieceCount : undefined,
    artist: changes.artist !== undefined ? state.artist : undefined,
    series: changes.series !== undefined ? state.series : undefined,
    barcodes:
      changes.barcodes !== undefined
        ? { ean: state.ean, upc: state.upc, modelNumber: state.modelNumber }
        : undefined,
    dimensions: changes.dimensions !== undefined ? state.dimensions : undefined,
    shape: changes.shape !== undefined ? state.shape : undefined,
    difficulty: changes.difficulty !== undefined ? state.difficulty : undefined,
    category: changes.category !== undefined ? state.category : undefined,
    tags:
      changes.tags !== undefined
        ? state.tags
          ? [...state.tags]
          : undefined
        : undefined,
    image: changes.image !== undefined ? state.image : undefined,
  };
};
