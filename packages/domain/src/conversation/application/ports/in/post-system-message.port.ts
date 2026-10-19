import { Result } from "../../../../shared-kernel";
import {
  ConversationError,
  MessageId,
  ThreadId,
  TradeEvent,
} from "../../../domain";
import { ConversationApplicationError } from "../../errors";

// The command to post a service-authored system message (e.g. "exchange shipped"). There is no
// member author: this path is invoked by the service, never by a participant. A trade lifecycle
// line carries its structured `tradeEvent` (body: the matching TRADE_EVENT_BODY token).
export interface PostSystemMessageCommand {
  readonly threadId: ThreadId;
  readonly body: string;
  readonly tradeEvent?: TradeEvent;
}

// Inbound port: the post-system-message use case. Yields the new message's id on success.
export interface PostSystemMessage {
  (
    cmd: PostSystemMessageCommand,
  ): Promise<
    Result<MessageId, ConversationError | ConversationApplicationError>
  >;
}
