import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Acquisition, Copy } from "../../domain";
import { LibraryApplicationError } from "../errors";
import { AcquireCopy, AcquireCopyCommand } from "../ports/in/acquire-copy.port";
import { CatalogSnapshotProvider } from "../ports/out/catalog-snapshot.provider";
import { CopyRepository } from "../ports/out/copy.repository";
import { CopyIdGenerator } from "../ports/out/id-generators";

export interface AcquireCopyDeps {
  readonly copies: CopyRepository;
  readonly snapshots: CatalogSnapshotProvider;
  readonly ids: CopyIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: fetch the acquisition context via the ACL provider, authorise the member
// against the definition's moderation status, then mint the Copy aggregate (which sets a private
// default sharing setting), persist, publish.
export const makeAcquireCopy =
  (deps: AcquireCopyDeps): AcquireCopy =>
  async (cmd: AcquireCopyCommand) => {
    const context = await deps.snapshots.getAcquisitionContext(
      cmd.puzzleDefinitionId,
    );
    if (!context)
      return err(
        LibraryApplicationError.puzzleNotFound(cmd.puzzleDefinitionId),
      );

    // A definition is acquirable by a member iff it is approved OR the member submitted it —
    // so a contributor can log their own copy of a not-yet-approved (pending/rejected) puzzle.
    const isOwnSubmission = context.submitterId === cmd.ownerId;
    if (context.status !== "approved" && !isOwnSubmission)
      return err(
        LibraryApplicationError.puzzleNotAcquirable(cmd.puzzleDefinitionId),
      );

    const snapshot = context.snapshot;

    const acquisition = cmd.acquisition
      ? Acquisition.create(cmd.acquisition)
      : Acquisition.unknown();

    const copy = Copy.acquire({
      id: deps.ids.next(),
      ownerId: cmd.ownerId,
      snapshot,
      condition: cmd.condition,
      acquisition,
      missingPiecesCount: cmd.missingPiecesCount,
      notes: cmd.notes,
      now: deps.clock.now(),
    });
    if (copy.isErr) return err(copy.error);

    await deps.copies.save(copy.value);
    await deps.events.publish(copy.value.pullEvents());
    return ok(copy.value.id);
  };
