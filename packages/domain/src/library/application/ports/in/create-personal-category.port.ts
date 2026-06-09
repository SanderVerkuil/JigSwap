import { Result } from "../../../../shared-kernel";
import { LibraryError, OwnerId, PersonalCategoryId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

export interface CreatePersonalCategoryCommand {
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly color?: string;
  readonly description?: string;
}

export interface CreatePersonalCategory {
  (
    cmd: CreatePersonalCategoryCommand,
  ): Promise<
    Result<PersonalCategoryId, LibraryError | LibraryApplicationError>
  >;
}
