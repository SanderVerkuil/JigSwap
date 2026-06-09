import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { ExchangeId, MemberId, Thread, ThreadId } from "../../domain";
import { FixedClock, InMemoryThreadRepository } from "../testing";
import { makeMarkThreadRead } from "./mark-thread-read";

const alice = toId<"MemberId">("alice") as MemberId;
const bob = toId<"MemberId">("bob") as MemberId;
const carol = toId<"MemberId">("carol") as MemberId; // outsider
const exchangeId = toId<"ExchangeId">("ex-1") as ExchangeId;
const threadId = toId<"ThreadId">("thread-1") as ThreadId;
const missingThread = toId<"ThreadId">("thread-404") as ThreadId;
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeMarkThreadRead", () => {
  let threads: InMemoryThreadRepository;
  let clock: FixedClock;
  let mark: ReturnType<typeof makeMarkThreadRead>;

  beforeEach(async () => {
    threads = new InMemoryThreadRepository();
    clock = new FixedClock(NOW);
    mark = makeMarkThreadRead({ threads, clock });
    await threads.save(Thread.open(threadId, exchangeId, [alice, bob]));
  });

  it("records only the caller's read receipt at the clock's now", async () => {
    const result = await mark({ threadId, memberId: alice });

    expect(result.isOk).toBe(true);
    const reloaded = await threads.findById(threadId);
    expect(reloaded?.lastReadAt(alice)).toEqual(NOW);
    expect(reloaded?.lastReadAt(bob)).toBeNull();
  });

  it("rejects ThreadNotFound", async () => {
    const result = await mark({ threadId: missingThread, memberId: alice });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ThreadNotFound");
  });

  it("rejects a non-participant", async () => {
    const result = await mark({ threadId, memberId: carol });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotParticipant");
    const reloaded = await threads.findById(threadId);
    expect(reloaded?.readReceipts).toHaveLength(0);
  });
});
