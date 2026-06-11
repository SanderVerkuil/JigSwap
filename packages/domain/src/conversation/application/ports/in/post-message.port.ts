import { Result } from "../../../../shared-kernel";
import {
  ConversationError,
  MemberId,
  MessageId,
  ThreadId,
} from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command to post a member-authored message to a thread. `authorId` is resolved from auth by
// the transport adapter. `kind` is text or image (system messages go through PostSystemMessage);
// for an image the `body` is a storage reference string.
export interface PostMessageCommand {
  readonly threadId: ThreadId;
  readonly authorId: MemberId;
  readonly kind: "text" | "image";
  readonly body: string;
}

// Inbound port: the post-message use case. Yields the new message's id on success.
export interface PostMessage {
  (
    cmd: PostMessageCommand,
  ): Promise<
    Result<MessageId, ConversationError | ConversationApplicationError>
  >;
}
