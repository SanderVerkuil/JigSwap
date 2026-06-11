import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { ConversationError, MessageId } from "../../domain";
import { ConversationApplicationError } from "../errors";
import {
  PostSystemMessage,
  PostSystemMessageCommand,
} from "../ports/in/post-system-message.port";
import { MessageIdGenerator } from "../ports/out/id-generators";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface PostSystemMessageDeps {
  readonly threads: ThreadRepository;
  readonly messageIds: MessageIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script for the service-authored path: load the thread (ThreadNotFound if absent),
// then delegate to Thread.postSystemMessage (only the non-empty-body rule applies; there is no
// member author and no participant check). On success persist and publish MessagePosted.
export const makePostSystemMessage =
  (deps: PostSystemMessageDeps): PostSystemMessage =>
  async (
    cmd: PostSystemMessageCommand,
  ): Promise<
    Result<MessageId, ConversationError | ConversationApplicationError>
  > => {
    const thread = await deps.threads.findById(cmd.threadId);
    if (!thread) {
      return err(ConversationApplicationError.threadNotFound(cmd.threadId));
    }

    const message = thread.postSystemMessage({
      id: deps.messageIds.next(),
      body: cmd.body,
      sentAt: deps.clock.now(),
    });
    if (message.isErr) return err(message.error);

    await deps.threads.save(thread);
    await deps.events.publish(thread.pullEvents());

    return ok(message.value.id);
  };
