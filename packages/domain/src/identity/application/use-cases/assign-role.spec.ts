import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import { Member, MemberId } from "../../domain";
import {
  FixedClock,
  InMemoryMemberRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeAssignRole } from "./assign-role";

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

describe("makeAssignRole", () => {
  let members: InMemoryMemberRepository;
  let events: RecordingEventPublisher;
  let assign: ReturnType<typeof makeAssignRole>;

  beforeEach(() => {
    members = new InMemoryMemberRepository();
    events = new RecordingEventPublisher();
    assign = makeAssignRole({ members, events, clock: new FixedClock(NOW) });
  });

  it("grants a role and publishes RoleAssigned", async () => {
    const id = seedMember(members);

    const result = await assign({ memberId: id, role: "admin" });
    expect(result.isOk).toBe(true);
    expect((await members.findById(id))?.hasRole("admin")).toBe(true);
    expect(events.names()).toEqual(["RoleAssigned"]);
  });

  it("is idempotent: re-assigning a held role publishes nothing", async () => {
    const id = seedMember(members);
    await assign({ memberId: id, role: "moderator" });
    events.published.length = 0;

    const result = await assign({ memberId: id, role: "moderator" });
    expect(result.isOk).toBe(true);
    expect(events.published).toHaveLength(0);
  });

  it("fails with InvalidRole for an unknown role and writes nothing", async () => {
    const id = seedMember(members);
    const result = await assign({ memberId: id, role: "superuser" });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRole");
    expect((await members.findById(id))?.roles.size).toBe(0);
  });

  it("fails with MemberNotFound for an unknown member", async () => {
    const result = await assign({ memberId: unknownId, role: "admin" });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MemberNotFound");
  });
});
