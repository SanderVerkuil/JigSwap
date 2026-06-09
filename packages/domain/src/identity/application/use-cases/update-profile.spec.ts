import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { Member, MemberId } from "../../domain";
import { FixedClock, InMemoryMemberRepository } from "../testing";
import { makeUpdateProfile } from "./update-profile";

const NOW = new Date("2026-06-08T10:00:00Z");
const unknownId = toId<"MemberId">("ghost") as MemberId;

const seedMember = (members: InMemoryMemberRepository): MemberId => {
  const result = Member.register({
    id: toId<"MemberId">("member-1") as MemberId,
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

describe("makeUpdateProfile", () => {
  let members: InMemoryMemberRepository;
  let update: ReturnType<typeof makeUpdateProfile>;

  beforeEach(() => {
    members = new InMemoryMemberRepository();
    update = makeUpdateProfile({ members, clock: new FixedClock(NOW) });
  });

  it("applies the edit and persists it", async () => {
    const id = seedMember(members);

    const result = await update({ memberId: id, bio: "Puzzler", username: "alice99" });
    expect(result.isOk).toBe(true);

    const saved = await members.findById(id);
    expect(saved?.toState().bio).toBe("Puzzler");
    expect(saved?.toState().username?.value).toBe("alice99");
  });

  it("fails with MemberNotFound for an unknown member", async () => {
    const result = await update({ memberId: unknownId, bio: "x" });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("MemberNotFound");
  });

  it("fails with InvalidUsername for a malformed handle", async () => {
    const id = seedMember(members);
    const result = await update({ memberId: id, username: "no good" });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidUsername");
  });
});
