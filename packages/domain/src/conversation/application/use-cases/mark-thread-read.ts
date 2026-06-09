import { Clock, err, ok, Result } from "../../../shared-kernel";
import { ConversationError } from "../../domain";
import { ConversationApplicationError } from "../errors";
import {
  MarkThreadRead,
  MarkThreadReadCommand,
} from "../ports/in/mark-thread-read.port";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface MarkThreadReadDeps {
  readonly threads: ThreadRepository;
  readonly clock: Clock;
}

// Transaction script: load the thread (ThreadNotFound if absent), then delegate to
// Thread.markRead, which updates only the caller's receipt (a non-participant is rejected). No
// domain event is recorded for a read, so there is nothing to publish — only the save persists it.
export const makeMarkThreadRead =
  (deps: MarkThreadReadDeps): MarkThreadRead =>
  async (
    cmd: MarkThreadReadCommand,
  ): Promise<Result<void, ConversationError | ConversationApplicationError>> => {
    const thread = await deps.threads.findById(cmd.threadId);
    if (!thread) {
      return err(ConversationApplicationError.threadNotFound(cmd.threadId));
    }

    const marked = thread.markRead(cmd.memberId, deps.clock.now());
    if (marked.isErr) return err(marked.error);

    await deps.threads.save(thread);
    return ok(undefined);
  };
