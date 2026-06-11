import { Result } from "../../../../shared-kernel";
import { ConversationError, MessageId, ThreadId } from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command to post a service-authored system message (e.g. "exchange shipped"). There is no
// member author: this path is invoked by the service, never by a participant.
export interface PostSystemMessageCommand {
  readonly threadId: ThreadId;
  readonly body: string;
}

// Inbound port: the post-system-message use case. Yields the new message's id on success.
export interface PostSystemMessage {
  (
    cmd: PostSystemMessageCommand,
  ): Promise<
    Result<MessageId, ConversationError | ConversationApplicationError>
  >;
}
