import { Result } from "../../../../shared-kernel";
import {
  ConversationError,
  CopyId,
  MediaMessageKind,
  MemberId,
  MessageId,
  ThreadId,
} from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command to post a member-authored message to a thread. `authorId` is resolved from auth by
// the transport adapter. `kind` is text, image or location (system messages go through
// PostSystemMessage). For a media kind the `body` is an optional caption and `attachmentRef` is
// required. The PUBLIC transport accepts text only; media is posted by internal server code once
// its attachment is verified and deliverable.
export interface PostMessageCommand {
  readonly threadId: ThreadId;
  readonly authorId: MemberId;
  readonly kind: "text" | MediaMessageKind;
  readonly body: string;
  // The media message's attachment (opaque). The transport adapter must establish that it belongs
  // to the author and this thread and is deliverable (the use case only carries it).
  readonly attachmentRef?: string;
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
