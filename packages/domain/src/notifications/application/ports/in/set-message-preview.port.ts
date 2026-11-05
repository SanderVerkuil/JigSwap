import { Result } from "../../../../shared-kernel";
import { MemberId, MessagePreviewChannel } from "../../../domain";

// The command to let one off-app channel (email or push) quote a message's text in a message
// notification, or not. A member with no stored preference yet has a default one materialised
// first.
export interface SetMessagePreviewCommand {
  readonly memberId: MemberId;
  readonly channel: MessagePreviewChannel;
  readonly enabled: boolean;
}

// Inbound port: the set-message-preview use case.
export interface SetMessagePreview {
  (cmd: SetMessagePreviewCommand): Promise<Result<void, never>>;
}
