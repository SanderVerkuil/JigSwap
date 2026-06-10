import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Member, MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryMemberRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeAssignRole } from "./assign-role";
import { makeRevokeRole } from "./revoke-role";

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

describe("makeRevokeRole", () => {
  let members: InMemoryMemberRepository;
  let events: RecordingEventPublisher;
  let assign: ReturnType<typeof makeAssignRole>;
  let revoke: ReturnType<typeof makeRevokeRole>;

  beforeEach(() => {
    members = new InMemoryMemberRepository();
    events = new RecordingEventPublisher();
    assign = makeAssignRole({ members, events, clock: new FixedClock(NOW) });
    revoke = makeRevokeRole({ members, events, clock: new FixedClock(NOW) });
  });

  it("withdraws a held role and publishes RoleRevoked", async () => {
    const id = seedMember(members);
    await assign({ memberId: id, role: "moderator" });
    events.published.length = 0;

    const result = await revoke({ memberId: id, role: "moderator" });
    expect(result.isOk).toBe(true);
    expect((await members.findById(id))?.hasRole("moderator")).toBe(false);
    expect(events.names()).toEqual(["RoleRevoked"]);
  });

  it("is idempotent: revoking an unheld role publishes nothing", async () => {
    const id = seedMember(members);

    const result = await revoke({ memberId: id, role: "admin" });
    expect(result.isOk).toBe(true);
    expect(events.published).toHaveLength(0);
  });

  it("fails with InvalidRole for an unknown role", async () => {
    const id = seedMember(members);
    const result = await revoke({ memberId: id, role: "superuser" });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRole");
  });

  it("fails with MemberNotFound for an unknown member", async () => {
    const result = await revoke({ memberId: unknownId, role: "admin" });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MemberNotFound");
  });
});
