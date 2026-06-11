import { ok, Result } from "../../../shared-kernel";
import { Thread, ThreadId } from "../../domain";
import { OpenThread, OpenThreadCommand } from "../ports/in/open-thread.port";
import { ThreadIdGenerator } from "../ports/out/id-generators";
import { ThreadRepository } from "../ports/out/thread.repository";

export interface OpenThreadDeps {
  readonly threads: ThreadRepository;
  readonly threadIds: ThreadIdGenerator;
}

// Transaction script: ensure exactly one Thread per exchange. If a thread already exists for the
// exchange, return its id unchanged (idempotent); otherwise open a fresh one with the supplied
// participants and persist it. Opening records no event, so there is nothing to publish here.
export const makeOpenThread =
  (deps: OpenThreadDeps): OpenThread =>
  async (cmd: OpenThreadCommand): Promise<Result<ThreadId, never>> => {
    const existing = await deps.threads.findByExchange(cmd.exchangeId);
    if (existing) return ok(existing.id);

    const thread = Thread.open(
      deps.threadIds.next(),
      cmd.exchangeId,
      cmd.participants,
    );
    await deps.threads.save(thread);
    return ok(thread.id);
  };
