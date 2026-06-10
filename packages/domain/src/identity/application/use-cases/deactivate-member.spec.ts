import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Member, MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryMemberRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeDeactivateMember } from "./deactivate-member";

const NOW = new Date("2026-06-08T10:00:00Z");
const unknownId = toMemberId("ghost");

const seedMember = (members: InMemoryMemberRepository): MemberId => {
  const result = Member.register({
    id: toMemberId("member-1"),
    clerkId: "clerk_abc",
    email: "alice@example.com",
    name: "Alice",
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  result.value.pullEvents();
  members.save(result.value);
  return result.value.id;
};

describe("makeDeactivateMember", () => {
  let members: InMemoryMemberRepository;
  let events: RecordingEventPublisher;
  let deactivate: ReturnType<typeof makeDeactivateMember>;

  beforeEach(() => {
    members = new InMemoryMemberRepository();
    events = new RecordingEventPublisher();
    deactivate = makeDeactivateMember({
      members,
      events,
      clock: new FixedClock(NOW),
    });
  });

  it("deactivates an active member and publishes MemberDeactivated", async () => {
    const id = seedMember(members);

    const result = await deactivate({ memberId: id });
    expect(result.isOk).toBe(true);
    expect((await members.findById(id))?.isActive).toBe(false);
    expect(events.names()).toEqual(["MemberDeactivated"]);
  });

  it("is idempotent: a second deactivate succeeds and publishes nothing", async () => {
    const id = seedMember(members);
    await deactivate({ memberId: id });
    events.published.length = 0;

    const result = await deactivate({ memberId: id });
    expect(result.isOk).toBe(true);
    expect(events.published).toHaveLength(0);
  });

  it("fails with MemberNotFound for an unknown member", async () => {
    const result = await deactivate({ memberId: unknownId });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MemberNotFound");
  });
});
