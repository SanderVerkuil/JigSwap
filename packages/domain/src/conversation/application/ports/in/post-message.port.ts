import { Result } from "../../../../shared-kernel";
import {
  ConversationError,
  CopyId,
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
  // Optional: the copy the message is about. The transport adapter must establish that the
  // author may reference it (the use case only carries it onto the message).
  readonly copyId?: CopyId;
}

// Inbound port: the post-message use case. Yields the new message's id on success.
export interface PostMessage {
  (
    cmd: PostMessageCommand,
  ): Promise<
    Result<MessageId, ConversationError | ConversationApplicationError>
  >;
}
