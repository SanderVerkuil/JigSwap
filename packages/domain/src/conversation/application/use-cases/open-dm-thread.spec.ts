import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { ConnectionPolicy } from "../ports/out/connection-policy";
import {
  InMemoryThreadRepository,
  SequentialThreadIdGenerator,
} from "../testing";
import { makeOpenDmThread } from "./open-dm-thread";

const alice = toMemberId("alice");
const bob = toMemberId("bob");

const allow: ConnectionPolicy = { canMessage: async () => true };
const deny: ConnectionPolicy = { canMessage: async () => false };

describe("makeOpenDmThread", () => {
  let threads: InMemoryThreadRepository;

  beforeEach(() => {
    threads = new InMemoryThreadRepository();
  });

  const make = (connections: ConnectionPolicy) =>
    makeOpenDmThread({
      threads,
      threadIds: new SequentialThreadIdGenerator(),
      connections,
    });

  it("opens a fresh DM thread and returns its id", async () => {
    const open = make(allow);

    const result = await open({ initiatorId: alice, recipientId: bob });

    expect(result.isOk).toBe(true);
    expect(threads.size()).toBe(1);
    if (result.isOk) {
      const thread = await threads.findById(result.value);
      expect(thread?.subject).toEqual({ kind: "dm" });
      expect(thread?.participants).toEqual([alice, bob]);
    }
  });

  it("is idempotent for the same pair regardless of argument order", async () => {
    const open = make(allow);

    const first = await open({ initiatorId: alice, recipientId: bob });
    const second = await open({ initiatorId: bob, recipientId: alice });

    expect(first.isOk && second.isOk).toBe(true);
    if (first.isOk && second.isOk) expect(second.value).toBe(first.value);
    expect(threads.size()).toBe(1);
  });

  it("rejects NotConnected when the policy denies, and writes nothing", async () => {
    const open = make(deny);

    const result = await open({ initiatorId: alice, recipientId: bob });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotConnected");
    expect(threads.size()).toBe(0);
  });

  it("rejects a self-DM without consulting the policy", async () => {
    const throwing: ConnectionPolicy = {
      canMessage: async () => {
        throw new Error("policy must not be consulted for a self-DM");
      },
    };
    const open = make(throwing);

    const result = await open({ initiatorId: alice, recipientId: alice });

    expect(result.isErr).toBe(true);
    if (result.isErr)
      expect(result.error.code).toBe("DmRequiresTwoParticipants");
    expect(threads.size()).toBe(0);
  });
});
