import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import {
  CatalogError,
  PuzzleDefinition,
  PuzzleDefinitionId,
} from "../../domain";
import { CatalogApplicationError } from "../errors";
import {
  SubmitPuzzleDefinition,
  SubmitPuzzleDefinitionCommand,
} from "../ports/in/submit-puzzle-definition.port";
import { CatalogIdGenerator } from "../ports/out/catalog-id-generator";
import { PuzzleDefinitionRepository } from "../ports/out/puzzle-definition.repository";

export interface SubmitPuzzleDefinitionDeps {
  readonly definitions: PuzzleDefinitionRepository;
  readonly ids: CatalogIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: enforce the cross-aggregate barcode-uniqueness rule via a repository
// lookup, then delegate the entity rules (title/pieceCount/barcode-format) to the aggregate.
export const makeSubmitPuzzleDefinition =
  (deps: SubmitPuzzleDefinitionDeps): SubmitPuzzleDefinition =>
  async (
    cmd: SubmitPuzzleDefinitionCommand,
  ): Promise<
    Result<PuzzleDefinitionId, CatalogError | CatalogApplicationError>
  > => {
    const duplicate = await firstDuplicateBarcode(deps.definitions, cmd);
    if (duplicate)
      return err(CatalogApplicationError.duplicateBarcode(duplicate));

    const definition = PuzzleDefinition.submit({
      id: deps.ids.nextPuzzleDefinitionId(),
      title: cmd.title,
      pieceCount: cmd.pieceCount,
      submittedBy: cmd.submittedBy,
      now: deps.clock.now(),
      description: cmd.description,
      brand: cmd.brand,
      artist: cmd.artist,
      series: cmd.series,
      barcodes: cmd.barcodes,
      dimensions: cmd.dimensions,
      shape: cmd.shape,
      difficulty: cmd.difficulty,
      category: cmd.category,
      tags: cmd.tags,
      image: cmd.image,
    });
    if (definition.isErr) return err(definition.error);

    // A trusted submitter (admin) skips moderation: approve in the same transaction so the
    // definition is publicly listable immediately. Both Submitted + Approved events are emitted.
    if (cmd.autoApprove) {
      const approved = definition.value.approve(deps.clock.now());
      // Stryker disable next-line ConditionalExpression: `definition` was just created by submit(),
      // so it is always `pending`; the pending -> approved transition is always legal, making this
      // error branch unreachable here. Kept as a defensive guard against a future submit() that
      // could yield a non-pending state — an equivalent mutant under the current factory.
      if (approved.isErr) return err(approved.error);
    }

    await deps.definitions.save(definition.value);
    await deps.events.publish(definition.value.pullEvents());
    return ok(definition.value.id);
  };

// Return the first supplied barcode already taken by another definition, else null. (Format
// validity is the aggregate's job; here we only check uniqueness of the raw values.)
const firstDuplicateBarcode = async (
  definitions: PuzzleDefinitionRepository,
  cmd: SubmitPuzzleDefinitionCommand,
): Promise<string | null> => {
  const candidates = [
    cmd.barcodes?.ean,
    cmd.barcodes?.upc,
    cmd.barcodes?.modelNumber,
  ].filter((value): value is string => value !== undefined && value.length > 0);

  for (const barcode of candidates) {
    const existing = await definitions.findByBarcode(barcode);
    if (existing) return barcode;
  }
  return null;
};
