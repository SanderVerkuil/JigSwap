import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { MemberId } from "./ids";
import { Member, RegisterProps } from "./member";

const memberId = toId<"MemberId">("member-1") as MemberId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const props = (over: Partial<RegisterProps> = {}): RegisterProps => ({
  id: memberId,
  clerkId: "clerk_abc",
  email: "alice@example.com",
  name: "Alice",
  username: "alice",
  now: NOW,
  ...over,
});

const register = (over: Partial<RegisterProps> = {}): Member => {
  const result = Member.register(props(over));
  if (!result.isOk) throw new Error("setup");
  return result.value;
};

describe("Member.register", () => {
  it("mints an active, role-less member and records MemberRegistered", () => {
    const result = Member.register(props());
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const member = result.value;
    expect(member.isActive).toBe(true);
    expect(member.roles.size).toBe(0);

    const events = member.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["MemberRegistered"]);
    const registered = events[0] as unknown as { clerkId: string; email: string };
    expect(registered.clerkId).toBe("clerk_abc");
    expect(registered.email).toBe("alice@example.com");
  });

  it("validates the email through the EmailAddress VO", () => {
    const result = Member.register(props({ email: "not-an-email" }));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidEmail");
  });

  it("validates a supplied username and treats an empty one as absent", () => {
    expect(Member.register(props({ username: "ab" })).isErr).toBe(true);
    const blank = Member.register(props({ username: "" }));
    expect(blank.isOk).toBe(true);
    if (blank.isOk) expect(blank.value.toState().username).toBeUndefined();
  });
});

describe("Member clerkId immutability", () => {
  it("accepts a re-asserted matching clerkId", () => {
    const member = register();
    expect(member.ensureClerkId("clerk_abc").isOk).toBe(true);
  });

  it("rejects a mismatched clerkId with ClerkIdImmutable", () => {
    const member = register();
    const result = member.ensureClerkId("clerk_other");
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ClerkIdImmutable");
  });
});

describe("Member.deactivate", () => {
  it("emits MemberDeactivated once on the active -> inactive transition", () => {
    const member = register();
    member.pullEvents(); // discard MemberRegistered

    member.deactivate(LATER);
    expect(member.isActive).toBe(false);
    expect(member.pullEvents().map((e) => e.name)).toEqual(["MemberDeactivated"]);
  });

  it("is idempotent: a second deactivate emits nothing", () => {
    const member = register();
    member.pullEvents();
    member.deactivate(LATER);
    member.pullEvents();

    member.deactivate(LATER);
    expect(member.isActive).toBe(false);
    expect(member.pullEvents()).toHaveLength(0);
  });
});

describe("Member roles", () => {
  it("assigns a role and audits it with RoleAssigned", () => {
    const member = register();
    member.pullEvents();

    member.assignRole("admin", LATER);
    expect(member.hasRole("admin")).toBe(true);
    const events = member.pullEvents() as unknown as Array<{ name: string; role: string }>;
    expect(events.map((e) => e.name)).toEqual(["RoleAssigned"]);
    expect(events[0].role).toBe("admin");
  });

  it("is idempotent on re-assigning a held role", () => {
    const member = register();
    member.assignRole("moderator", LATER);
    member.pullEvents();

    member.assignRole("moderator", LATER);
    expect(member.pullEvents()).toHaveLength(0);
  });

  it("revokes a held role and audits it with RoleRevoked", () => {
    const member = register();
    member.assignRole("moderator", LATER);
    member.pullEvents();

    member.revokeRole("moderator", LATER);
    expect(member.hasRole("moderator")).toBe(false);
    expect(member.pullEvents().map((e) => e.name)).toEqual(["RoleRevoked"]);
  });

  it("is a no-op when revoking a role the member never held", () => {
    const member = register();
    member.pullEvents();
    member.revokeRole("admin", LATER);
    expect(member.pullEvents()).toHaveLength(0);
  });
});

describe("Member.updateProfile", () => {
  it("edits only the supplied fields and validates a new username", () => {
    const member = register();
    member.pullEvents();

    const ok = member.updateProfile({ bio: "Puzzler", location: "NL" }, LATER);
    expect(ok.isOk).toBe(true);
    const state = member.toState();
    expect(state.bio).toBe("Puzzler");
    expect(state.location).toBe("NL");
    expect(state.name).toBe("Alice"); // untouched
    expect(state.updatedAt).toBe(LATER);
    // Profile edits are not audited.
    expect(member.pullEvents()).toHaveLength(0);
  });

  it("rejects an invalid new username", () => {
    const member = register();
    const result = member.updateProfile({ username: "no good" }, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidUsername");
  });
});

describe("Member persistence", () => {
  it("round-trips through toState/rehydrate without re-emitting events", () => {
    const member = register();
    member.assignRole("admin", LATER);
    const state = member.toState();

    const rehydrated = Member.rehydrate(state);
    expect(rehydrated.id).toBe(memberId);
    expect(rehydrated.clerkId).toBe("clerk_abc");
    expect(rehydrated.hasRole("admin")).toBe(true);
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
