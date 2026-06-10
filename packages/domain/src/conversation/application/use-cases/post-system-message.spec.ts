import { beforeEach, describe, expect, it } from "vitest";
import { toExchangeId, toMemberId, toThreadId } from "../../../shared-kernel";
import { MemberId, Thread } from "../../domain";
import {
  FixedClock,
  InMemoryThreadRepository,
  RecordingEventPublisher,
  SequentialMessageIdGenerator,
} from "../testing";
import { makePostSystemMessage } from "./post-system-message";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const exchangeId = toExchangeId("ex-1");
const threadId = toThreadId("thread-1");
const missingThread = toThreadId("thread-404");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makePostSystemMessage", () => {
  let threads: InMemoryThreadRepository;
  let events: RecordingEventPublisher;
  let post: ReturnType<typeof makePostSystemMessage>;

  beforeEach(async () => {
    threads = new InMemoryThreadRepository();
    events = new RecordingEventPublisher();
    post = makePostSystemMessage({
      threads,
      messageIds: new SequentialMessageIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
    await threads.save(Thread.open(threadId, exchangeId, [alice, bob]));
  });

  it("posts a service-authored system message with no member author and publishes MessagePosted", async () => {
    const result = await post({ threadId, body: "Exchange shipped" });

    expect(result.isOk).toBe(true);
    expect(events.names()).toEqual(["MessagePosted"]);
    const posted = events.published[0] as unknown as {
      authorId: MemberId | null;
      kind: string;
    };
    expect(posted.authorId).toBeNull();
    expect(posted.kind).toBe("system");

    const reloaded = await threads.findById(threadId);
    expect(reloaded?.messages[0]?.authorId).toBeNull();
  });

  it("rejects ThreadNotFound and writes nothing", async () => {
    const result = await post({
      threadId: missingThread,
      body: "Exchange shipped",
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ThreadNotFound");
    expect(events.published).toHaveLength(0);
  });

  it("rejects an empty system body and writes nothing", async () => {
    const result = await post({ threadId, body: "" });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("EmptyMessage");
    expect(events.published).toHaveLength(0);
  });
});
