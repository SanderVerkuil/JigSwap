import { beforeEach, describe, expect, it } from "vitest";
import { toExchangeId, toMemberId } from "../../../shared-kernel";

import {
  InMemoryThreadRepository,
  SequentialThreadIdGenerator,
} from "../testing";
import { makeOpenThread } from "./open-thread";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const exchangeId = toExchangeId("ex-1");

describe("makeOpenThread", () => {
  let threads: InMemoryThreadRepository;
  let open: ReturnType<typeof makeOpenThread>;

  beforeEach(() => {
    threads = new InMemoryThreadRepository();
    open = makeOpenThread({
      threads,
      threadIds: new SequentialThreadIdGenerator(),
    });
  });

  it("opens a fresh thread for an exchange and persists it", async () => {
    const result = await open({ exchangeId, participants: [alice, bob] });

    expect(result.isOk).toBe(true);
    expect(threads.size()).toBe(1);
    if (result.isOk) {
      const thread = await threads.findById(result.value);
      expect(thread?.participants).toEqual([alice, bob]);
    }
  });

  it("is idempotent: returns the existing thread id without opening a second", async () => {
    const first = await open({ exchangeId, participants: [alice, bob] });
    const second = await open({ exchangeId, participants: [alice, bob] });

    expect(first.isOk && second.isOk).toBe(true);
    if (first.isOk && second.isOk) expect(second.value).toBe(first.value);
    expect(threads.size()).toBe(1);
  });
});
