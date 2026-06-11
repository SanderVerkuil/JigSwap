import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { ConversationError, MessageId } from "../../domain";
import { ConversationApplicationError } from "../errors";
import { PostMessage, PostMessageCommand } from "../ports/in/post-message.port";
import { MessageIdGenerator } from "../ports/out/id-generators";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface PostMessageDeps {
  readonly threads: ThreadRepository;
  readonly messageIds: MessageIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the thread (ThreadNotFound if absent), then delegate the participant
// and non-empty-body rules to Thread.postMessage. On success persist the thread and publish its
// recorded MessagePosted.
export const makePostMessage =
  (deps: PostMessageDeps): PostMessage =>
  async (
    cmd: PostMessageCommand,
  ): Promise<
    Result<MessageId, ConversationError | ConversationApplicationError>
  > => {
    const thread = await deps.threads.findById(cmd.threadId);
    if (!thread) {
      return err(ConversationApplicationError.threadNotFound(cmd.threadId));
    }

    const message = thread.postMessage({
      id: deps.messageIds.next(),
      authorId: cmd.authorId,
      kind: cmd.kind,
      body: cmd.body,
      sentAt: deps.clock.now(),
    });
    if (message.isErr) return err(message.error);

    await deps.threads.save(thread);
    await deps.events.publish(thread.pullEvents());

    return ok(message.value.id);
  };
