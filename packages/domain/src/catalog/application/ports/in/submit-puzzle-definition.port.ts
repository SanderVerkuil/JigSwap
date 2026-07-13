import { Result } from "../../../../shared-kernel";
import {
  BarcodesInput,
  CatalogCategoryId,
  CatalogError,
  Difficulty,
  Dimensions,
  PuzzleDefinitionId,
  Shape,
  SubmitterId,
} from "../../../domain";
import { CatalogApplicationError } from "../../errors";

// The command to submit a new puzzle definition. `submittedBy` is resolved from auth by the
// transport adapter. Descriptive fields are optional; barcodes/pieceCount are validated.
export interface SubmitPuzzleDefinitionCommand {
  readonly title: string;
  readonly pieceCount: number;
  readonly submittedBy: SubmitterId;
  readonly description?: string;
  readonly brand?: string;
  readonly publisher?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly barcodes?: BarcodesInput;
  readonly dimensions?: Dimensions;
  readonly shape?: Shape;
  readonly difficulty?: Difficulty;
  readonly category?: CatalogCategoryId;
  readonly tags?: readonly string[];
  readonly image?: string;
  // When true, the submission is approved in the same transaction (a trusted submitter, e.g. an
  // admin, skips the moderation queue). The transport adapter decides this from the caller's role;
  // the domain just honours the flag.
  readonly autoApprove?: boolean;
}

// Inbound port: the submit-puzzle-definition use case.
export interface SubmitPuzzleDefinition {
  (
    cmd: SubmitPuzzleDefinitionCommand,
  ): Promise<
    Result<PuzzleDefinitionId, CatalogError | CatalogApplicationError>
  >;
}
