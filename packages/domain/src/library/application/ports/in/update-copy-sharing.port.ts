import { Result } from "../../../../shared-kernel";
import {
  CopyId,
  LibraryError,
  OwnerId,
  Price,
  Visibility,
} from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Command to replace a copy's sharing setting (the consolidated visibility + availability VO).
export interface UpdateCopySharingCommand {
  readonly actingMemberId: OwnerId;
  readonly copyId: CopyId;
  readonly visibility: Visibility;
  readonly forTrade?: boolean;
  readonly forSale?: boolean;
  readonly forLend?: boolean;
  readonly salePrice?: Price;
}

export interface UpdateCopySharing {
  (
    cmd: UpdateCopySharingCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}
