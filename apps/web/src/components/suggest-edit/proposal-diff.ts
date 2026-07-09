import type { PuzzleDefinitionView } from "@jigswap/contracts";

// Pure diff logic for the "Suggest an edit" form: the raw PuzzleDefinitionView is the baseline;
// buildProposalArgs produces the MINIMAL changed-fields args for gateway.catalog.proposeChange /
// editChangeProposal (every arg is optional server-side — omitted means unchanged).
//
// Inherited semantics (do not "fix" here — they mirror the backend update()):
// - Scalar fields cannot be CLEARED: an emptied text input is treated as unchanged.
// - Barcodes are one GROUP: if any of ean/upc/modelNumber differs, all three desired values are
//   sent and the group is replaced wholesale (which is also how a single barcode is cleared).
// - Tags CAN be cleared (sending [] replaces the list).

export type ProposalShape = "rectangular" | "panoramic" | "round" | "shaped";
export type ProposalDifficulty = "easy" | "medium" | "hard" | "expert";

export interface ProposalFormState {
  title: string;
  description: string;
  brand: string;
  pieceCount: number | undefined;
  artist: string;
  series: string;
  ean: string;
  upc: string;
  modelNumber: string;
  dimensions: { width: string; height: string; unit: "cm" | "in" };
  shape: "" | ProposalShape;
  difficulty: "" | ProposalDifficulty;
  categoryId: string; // selected adminCategories DOC id ("" = keep current)
  tags: string[];
  newImageStorageId: string | undefined; // set only when the member uploaded a NEW image
  comment: string;
}

// The stored diff shape of a puzzleChangeProposals row (`changes` column), used to prefill
// edit mode. `category` holds the Catalog AGGREGATE id; `image` a storage id.
export interface StoredProposalChanges {
  title?: string;
  description?: string;
  brand?: string;
  pieceCount?: number;
  artist?: string;
  series?: string;
  barcodes?: { ean?: string; upc?: string; modelNumber?: string };
  dimensions?: { width: number; height: number; unit: "cm" | "in" };
  shape?: ProposalShape;
  difficulty?: ProposalDifficulty;
  category?: string;
  tags?: string[];
  image?: string;
}

// The flat args sent to proposeChange/editChangeProposal (minus puzzleDefinitionId/
// changeProposalId/comment, which the page supplies).
export interface ProposalArgs {
  title?: string;
  description?: string;
  brand?: string;
  pieceCount?: number;
  artist?: string;
  series?: string;
  ean?: string;
  upc?: string;
  modelNumber?: string;
  dimensions?: { width: number; height: number; unit: "cm" | "in" };
  shape?: ProposalShape;
  difficulty?: ProposalDifficulty;
  category?: string;
  tags?: string[];
  image?: string;
}

export interface CategoryOption {
  readonly _id: string;
  readonly aggregateId?: string;
}

export const formFromView = (
  view: PuzzleDefinitionView,
): ProposalFormState => ({
  title: view.title,
  description: view.description ?? "",
  brand: view.brand ?? "",
  pieceCount: view.pieceCount,
  artist: view.artist ?? "",
  series: view.series ?? "",
  ean: view.ean ?? "",
  upc: view.upc ?? "",
  modelNumber: view.modelNumber ?? "",
  dimensions: view.dimensions
    ? {
        width: String(view.dimensions.width),
        height: String(view.dimensions.height),
        unit: view.dimensions.unit,
      }
    : { width: "", height: "", unit: "cm" },
  shape: view.shape ?? "",
  difficulty: view.difficulty ?? "",
  categoryId: (view.category as string | undefined) ?? "",
  tags: view.tags ? [...view.tags] : [],
  newImageStorageId: undefined,
  comment: "",
});

// Edit-mode prefill: apply the member's stored pending diff on top of the definition's values.
// A stored barcode group replaces all three members (unset ⇒ cleared, matching apply semantics);
// the stored category AGGREGATE id is resolved back to the select's doc id.
export const overlayProposal = (
  base: ProposalFormState,
  changes: StoredProposalChanges,
  comment: string | undefined,
  categories: readonly CategoryOption[],
): ProposalFormState => ({
  ...base,
  title: changes.title ?? base.title,
  description: changes.description ?? base.description,
  brand: changes.brand ?? base.brand,
  pieceCount: changes.pieceCount ?? base.pieceCount,
  artist: changes.artist ?? base.artist,
  series: changes.series ?? base.series,
  ...(changes.barcodes
    ? {
        ean: changes.barcodes.ean ?? "",
        upc: changes.barcodes.upc ?? "",
        modelNumber: changes.barcodes.modelNumber ?? "",
      }
    : {}),
  dimensions: changes.dimensions
    ? {
        width: String(changes.dimensions.width),
        height: String(changes.dimensions.height),
        unit: changes.dimensions.unit,
      }
    : base.dimensions,
  shape: changes.shape ?? base.shape,
  difficulty: changes.difficulty ?? base.difficulty,
  categoryId: changes.category
    ? (categories.find((c) => (c.aggregateId ?? c._id) === changes.category)
        ?._id ?? base.categoryId)
    : base.categoryId,
  tags: changes.tags ? [...changes.tags] : base.tags,
  newImageStorageId: changes.image,
  comment: comment ?? "",
});

// A trimmed text change; undefined = unchanged. Empty input ⇒ unchanged (no scalar clearing).
const textChange = (
  formValue: string,
  current: string | undefined,
): string | undefined => {
  const trimmed = formValue.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed === (current ?? "") ? undefined : trimmed;
};

export const buildProposalArgs = (
  view: PuzzleDefinitionView,
  form: ProposalFormState,
  categories: readonly CategoryOption[],
): ProposalArgs | null => {
  const args: ProposalArgs = {
    title: textChange(form.title, view.title),
    description: textChange(form.description, view.description),
    brand: textChange(form.brand, view.brand),
    artist: textChange(form.artist, view.artist),
    series: textChange(form.series, view.series),
  };

  if (form.pieceCount !== undefined && form.pieceCount !== view.pieceCount) {
    args.pieceCount = form.pieceCount;
  }

  // Barcode GROUP: any changed member ⇒ send all three desired values (group replace).
  const desired = {
    ean: form.ean.trim() || undefined,
    upc: form.upc.trim() || undefined,
    modelNumber: form.modelNumber.trim() || undefined,
  };
  const groupChanged =
    desired.ean !== (view.ean ?? undefined) ||
    desired.upc !== (view.upc ?? undefined) ||
    desired.modelNumber !== (view.modelNumber ?? undefined);
  // Caveat: if ALL desired members are undefined the backend sees no barcode arg and the group
  // stays unchanged — clearing the entire group is not supported (parity with updatePuzzleDefinition).
  if (groupChanged) {
    args.ean = desired.ean;
    args.upc = desired.upc;
    args.modelNumber = desired.modelNumber;
  }

  if (form.dimensions.width && form.dimensions.height) {
    const dims = {
      width: Number(form.dimensions.width),
      height: Number(form.dimensions.height),
      unit: form.dimensions.unit,
    };
    const current = view.dimensions;
    if (
      !current ||
      current.width !== dims.width ||
      current.height !== dims.height ||
      current.unit !== dims.unit
    ) {
      args.dimensions = dims;
    }
  }

  if (form.shape && form.shape !== (view.shape ?? "")) args.shape = form.shape;
  if (form.difficulty && form.difficulty !== (view.difficulty ?? "")) {
    args.difficulty = form.difficulty;
  }

  if (
    form.categoryId &&
    form.categoryId !== ((view.category as string | undefined) ?? "")
  ) {
    const option = categories.find((c) => c._id === form.categoryId);
    if (option) args.category = option.aggregateId ?? option._id;
  }

  const baseTags = view.tags ?? [];
  const tagsChanged =
    form.tags.length !== baseTags.length ||
    form.tags.some((tag, index) => baseTags[index] !== tag);
  if (tagsChanged) args.tags = [...form.tags];

  if (form.newImageStorageId) args.image = form.newImageStorageId;

  // Drop undefined members EXCEPT inside a sent barcode group (an undefined group member is
  // meaningful: it clears that barcode). groupChanged decides the group's presence wholesale.
  const entries = Object.entries(args).filter(([key, value]) =>
    groupChanged && (key === "ean" || key === "upc" || key === "modelNumber")
      ? true
      : value !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as ProposalArgs)
    : null;
};
