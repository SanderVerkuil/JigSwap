import { err, ok, Result } from "../../../shared-kernel";
import { ConversationError, Thread, ThreadId } from "../../domain";
import { ConversationApplicationError } from "../errors";
import {
  OpenCircleThread,
  OpenCircleThreadCommand,
} from "../ports/in/open-circle-thread.port";
import { CircleRoster } from "../ports/out/circle-roster";
import { ThreadIdGenerator } from "../ports/out/id-generators";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface OpenCircleThreadDeps {
  readonly threads: ThreadRepository;
  readonly threadIds: ThreadIdGenerator;
  readonly roster: CircleRoster;
}

// Transaction script: ensure exactly one thread per circle. The roster gates first — an unknown
// circle and an actor outside it are the same CircleNotFound — then an existing thread is
// returned unchanged (idempotent), else a fresh one is seeded from the roster's members and
// joinedAt. Opening records no event, so there is nothing to publish here.
export const makeOpenCircleThread =
  (deps: OpenCircleThreadDeps): OpenCircleThread =>
  async (
    cmd: OpenCircleThreadCommand,
  ): Promise<
    Result<ThreadId, ConversationError | ConversationApplicationError>
  > => {
    const members = await deps.roster.membersOf(cmd.circleId);
    if (!members?.some((m) => m.memberId === cmd.actorId)) {
      return err(ConversationApplicationError.circleNotFound(cmd.circleId));
    }

    const existing = await deps.threads.findByCircle(cmd.circleId);
    if (existing) return ok(existing.id);

    const opened = Thread.openForCircle(
      deps.threadIds.next(),
      cmd.circleId,
      members,
    );
    if (opened.isErr) return err(opened.error);

    await deps.threads.save(opened.value);
    return ok(opened.value.id);
  };
