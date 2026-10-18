import { DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { ConversationError, SYSTEM_EVENT_BODY } from "../../domain";
import {
  SyncCircleParticipant,
  SyncCircleParticipantCommand,
} from "../ports/in/sync-circle-participant.port";
import { MessageIdGenerator } from "../ports/out/id-generators";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface SyncCircleParticipantDeps {
  readonly threads: ThreadRepository;
  readonly messageIds: MessageIdGenerator;
  readonly events: DomainEventPublisher;
}

// Transaction script run by the circle-membership subscriber. No thread yet: nothing to do (the
// thread is created lazily, seeded from the roster). Otherwise add or remove the member at `at`;
// when that changed the set, post the join/leave system message (body token + systemEvent, sent
// at `at`) and persist and publish both in one unit of work. An unchanged set writes nothing.
export const makeSyncCircleParticipant =
  (deps: SyncCircleParticipantDeps): SyncCircleParticipant =>
  async (
    cmd: SyncCircleParticipantCommand,
  ): Promise<Result<void, ConversationError>> => {
    const thread = await deps.threads.findByCircle(cmd.circleId);
    if (!thread) return ok(undefined);

    const changed =
      cmd.change === "joined"
        ? thread.addParticipant(cmd.memberId, cmd.at)
        : thread.removeParticipant(cmd.memberId, cmd.at);
    if (changed.isErr) return err(changed.error);
    if (!changed.value) return ok(undefined);

    const posted = thread.postSystemMessage({
      id: deps.messageIds.next(),
      body: SYSTEM_EVENT_BODY[cmd.change],
      sentAt: cmd.at,
      systemEvent: { kind: cmd.change, memberId: cmd.memberId },
    });
    if (posted.isErr) return err(posted.error);

    await deps.threads.save(thread);
    await deps.events.publish(thread.pullEvents());
    return ok(undefined);
  };
