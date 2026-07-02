import { beforeEach, describe, expect, it } from "vitest";
import { toExchangeId, toMemberId, toThreadId } from "../../../shared-kernel";
import { MemberId, Thread } from "../../domain";
import {
  FixedClock,
  InMemoryThreadRepository,
  RecordingEventPublisher,
  SequentialMessageIdGenerator,
} from "../testing";
import { makePostMessage } from "./post-message";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const carol = toMemberId("carol"); // outsider
const exchangeId = toExchangeId("ex-1");
const threadId = toThreadId("thread-1");
const missingThread = toThreadId("thread-404");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makePostMessage", () => {
  let threads: InMemoryThreadRepository;
  let events: RecordingEventPublisher;
  let post: ReturnType<typeof makePostMessage>;

  beforeEach(async () => {
    threads = new InMemoryThreadRepository();
    events = new RecordingEventPublisher();
    post = makePostMessage({
      threads,
      messageIds: new SequentialMessageIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
    await threads.save(
      Thread.openForExchange(threadId, exchangeId, [alice, bob]),
    );
  });

  const cmd = (over: Partial<Parameters<typeof post>[0]> = {}) => ({
    threadId,
    authorId: alice,
    kind: "text" as const,
    body: "hello bob",
    ...over,
  });

  it("posts a participant's message, persists it, and publishes MessagePosted", async () => {
    const result = await post(cmd());

    expect(result.isOk).toBe(true);
    const reloaded = await threads.findById(threadId);
    expect(reloaded?.messages).toHaveLength(1);
    expect(events.names()).toEqual(["MessagePosted"]);
    const posted = events.published[0] as unknown as {
      authorId: MemberId | null;
      kind: string;
    };
    expect(posted.authorId).toBe(alice);
    expect(posted.kind).toBe("text");
  });

  it("rejects ThreadNotFound and writes nothing", async () => {
    const result = await post(cmd({ threadId: missingThread }));

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ThreadNotFound");
    expect(events.published).toHaveLength(0);
  });

  it("rejects a non-participant and writes nothing", async () => {
    const result = await post(cmd({ authorId: carol }));

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotParticipant");
    const reloaded = await threads.findById(threadId);
    expect(reloaded?.messages).toHaveLength(0);
    expect(events.published).toHaveLength(0);
  });

  it("rejects an empty body and writes nothing", async () => {
    const result = await post(cmd({ body: "" }));

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
    expect(events.published).toHaveLength(0);
  });
});
