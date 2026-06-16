import { Result } from "../../../../shared-kernel";
import { SocialError } from "../../../domain";
import { MemberId } from "../../../domain/ids";
import { SocialApplicationError } from "../../errors";

// The command to arrange a member's profile shelf: the ordered set of owned copy ids to feature.
// `memberId` is resolved from auth by the transport adapter; `copyIds` is the client-supplied
// ordered list (deduped and capped to MAX_FEATURED by the domain).
export interface ArrangeShelfCommand {
  readonly memberId: MemberId;
  readonly copyIds: readonly string[];
}

// Inbound port: the arrange-shelf use case. Fails with ProfileNotFound when the member has no
// profile yet.
export type ArrangeShelf = (
  cmd: ArrangeShelfCommand,
) => Promise<Result<void, SocialError | SocialApplicationError>>;
