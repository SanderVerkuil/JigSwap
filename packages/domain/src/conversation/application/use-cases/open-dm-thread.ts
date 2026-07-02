import { err, ok, Result } from "../../../shared-kernel";
import { ConversationError, Thread, ThreadId } from "../../domain";
import { ConversationApplicationError } from "../errors";
import {
  OpenDmThread,
  OpenDmThreadCommand,
} from "../ports/in/open-dm-thread.port";
import { ConnectionPolicy } from "../ports/out/connection-policy";
import { ThreadIdGenerator } from "../ports/out/id-generators";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface OpenDmThreadDeps {
  readonly threads: ThreadRepository;
  readonly threadIds: ThreadIdGenerator;
  readonly connections: ConnectionPolicy;
}

// Transaction script: ensure exactly one DM thread per member pair. The pair rule (self-DM) is
// the aggregate's own invariant and fails before any I/O; the connection gate is the
// ConnectionPolicy's answer; the pair-uniqueness rule is the order-insensitive repository lookup.
// Opening records no event, so there is nothing to publish here.
export const makeOpenDmThread =
  (deps: OpenDmThreadDeps): OpenDmThread =>
  async (
    cmd: OpenDmThreadCommand,
  ): Promise<
    Result<ThreadId, ConversationError | ConversationApplicationError>
  > => {
    const opened = Thread.openDm(deps.threadIds.next(), [
      cmd.initiatorId,
      cmd.recipientId,
    ]);
    if (opened.isErr) return err(opened.error); // self-DM: fail before any I/O

    if (
      !(await deps.connections.canMessage(cmd.initiatorId, cmd.recipientId))
    ) {
      return err(ConversationApplicationError.notConnected());
    }

    const existing = await deps.threads.findDmByParticipants(
      cmd.initiatorId,
      cmd.recipientId,
    );
    if (existing) return ok(existing.id);

    await deps.threads.save(opened.value);
    return ok(opened.value.id);
  };
