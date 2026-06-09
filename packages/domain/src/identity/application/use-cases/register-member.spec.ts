import { beforeEach, describe, expect, it } from "vitest";
import {
  FixedClock,
  InMemoryMemberRepository,
  RecordingEventPublisher,
  SequentialMemberIdGenerator,
} from "../testing";
import { makeRegisterMember } from "./register-member";

const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeRegisterMember", () => {
  let members: InMemoryMemberRepository;
  let events: RecordingEventPublisher;
  let register: ReturnType<typeof makeRegisterMember>;

  beforeEach(() => {
    members = new InMemoryMemberRepository();
    events = new RecordingEventPublisher();
    register = makeRegisterMember({
      members,
      memberIds: new SequentialMemberIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });
  });

  const cmd = (over: Partial<Parameters<typeof register>[0]> = {}) => ({
    clerkId: "clerk_abc",
    email: "alice@example.com",
    name: "Alice",
    username: "alice",
    ...over,
  });

  it("registers a new member, persists it, and publishes MemberRegistered", async () => {
    const result = await register(cmd());

    expect(result.isOk).toBe(true);
    expect(members.size()).toBe(1);
    expect(events.names()).toEqual(["MemberRegistered"]);
  });

  it("is idempotent per clerkId: returns the existing id and writes nothing new", async () => {
    const first = await register(cmd());
    expect(first.isOk).toBe(true);
    const firstId = first.isOk ? first.value : undefined;

    const second = await register(cmd({ name: "Alice Again", email: "alice2@example.com" }));
    expect(second.isOk).toBe(true);
    expect(second.isOk ? second.value : undefined).toBe(firstId);

    expect(members.size()).toBe(1); // no duplicate identity
    expect(events.names()).toEqual(["MemberRegistered"]); // only the first emitted
  });

  it("rejects an invalid email without writing", async () => {
    const result = await register(cmd({ email: "nope" }));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidEmail");
    expect(members.size()).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it("rejects an invalid username without writing", async () => {
    const result = await register(cmd({ username: "no good" }));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidUsername");
    expect(members.size()).toBe(0);
  });
});
