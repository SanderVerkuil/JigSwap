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

// The subset of the raw definition DTO this helper reads, declared structurally so the pure
// module needs no dependency on @jigswap/contracts (the web tier derives view types from the
// gateway). The suggest-edit page passes the gateway-derived `puzzleById` result, which
// satisfies this shape (branded ids assign to string; mutable arrays to readonly).
export interface ProposalTargetView {
  readonly title: string;
  readonly description?: string;
  readonly brand?: string;
  readonly publisher?: string;
  readonly pieceCount: number;
  readonly artist?: string;
  readonly series?: string;
  readonly ean?: string;
  readonly upc?: string;
  readonly modelNumber?: string;
  readonly dimensions?: { width: number; height: number; unit: "cm" | "in" };
  readonly shape?: ProposalShape;
  readonly difficulty?: ProposalDifficulty;
  readonly category?: string;
  readonly tags?: readonly string[];
}

export interface ProposalFormState {
  title: string;
  description: string;
  brand: string;
  publisher: string;
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
  publisher?: string;
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
  publisher?: string;
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

export const formFromView = (view: ProposalTargetView): ProposalFormState => ({
  title: view.title,
  description: view.description ?? "",
  brand: view.brand ?? "",
  publisher: view.publisher ?? "",
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
  categoryId: view.category ?? "",
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
  publisher: changes.publisher ?? base.publisher,
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
  view: ProposalTargetView,
  form: ProposalFormState,
  categories: readonly CategoryOption[],
): ProposalArgs | null => {
  const args: ProposalArgs = {
    title: textChange(form.title, view.title),
    description: textChange(form.description, view.description),
    brand: textChange(form.brand, view.brand),
    publisher: textChange(form.publisher, view.publisher),
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
    desired.ean !== view.ean ||
    desired.upc !== view.upc ||
    desired.modelNumber !== view.modelNumber;
  const hasDesired = Boolean(desired.ean || desired.upc || desired.modelNumber);
  // Caveat: clearing the entire group is not supported by the backend (parity with
  // updatePuzzleDefinition), so an all-empty desired group is treated as no change — the
  // helper returns null instead of a diff the server would reject.
  const sendGroup = groupChanged && hasDesired;
  if (sendGroup) {
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

  if (form.categoryId && form.categoryId !== (view.category ?? "")) {
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
  // meaningful: it clears that barcode). sendGroup decides the group's presence wholesale.
  const entries = Object.entries(args).filter(([key, value]) =>
    sendGroup && (key === "ean" || key === "upc" || key === "modelNumber")
      ? true
      : value !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as ProposalArgs)
    : null;
};

// For the edit forms' "Changes (N)" summary panel: buildProposalArgs only reports an
// `image` change once `form.newImageStorageId` is set, which happens after upload at submit
// time — a freshly picked (not-yet-uploaded) file must still count as a pending change, so a
// chosen file synthesizes the `image` key here when the args don't already carry one.
export const pendingChanges = (
  args: ProposalArgs | null,
  hasNewImage: boolean,
): Record<string, unknown> => ({
  ...(args ?? {}),
  ...(hasNewImage && !args?.image ? { image: true } : {}),
});
