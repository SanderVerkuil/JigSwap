import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { MemberId, ProfileId } from "./ids";
import { EditProps, Profile } from "./profile";

const member = toId<"MemberId">("alice") as MemberId;
const profileId = toId<"ProfileId">("profile-1") as ProfileId;
const NOW = new Date("2026-06-08T10:00:00Z");

const editProps = (over: Partial<EditProps> = {}): EditProps => ({
  displayName: "Alice",
  bio: "Loves 1000-piece landscapes",
  now: NOW,
  ...over,
});

describe("Profile.create", () => {
  it("opens a profile and records ProfileUpdated with the trimmed display name", () => {
    const result = Profile.create(profileId, member, editProps({ displayName: "  Alice  " }));
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const profile = result.value;
    expect(profile.displayName.value).toBe("Alice");
    expect(profile.bio).toBe("Loves 1000-piece landscapes");

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileUpdated"]);
    const updated = events[0] as unknown as {
      profileId: ProfileId;
      memberId: MemberId;
      displayName: string;
    };
    expect(updated.profileId).toBe(profileId);
    expect(updated.memberId).toBe(member);
    expect(updated.displayName).toBe("Alice");
  });

  it("rejects an empty/whitespace display name", () => {
    const result = Profile.create(profileId, member, editProps({ displayName: "   " }));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDisplayName");
  });
});

describe("Profile.edit", () => {
  const open = (): Profile => {
    const result = Profile.create(profileId, member, editProps());
    if (!result.isOk) throw new Error("setup");
    result.value.pullEvents(); // discard the creation event
    return result.value;
  };

  it("updates fields and emits ProfileUpdated with the new display name", () => {
    const profile = open();
    const edited = profile.edit(editProps({ displayName: "Alice B.", bio: "Updated" }));
    expect(edited.isOk).toBe(true);
    expect(profile.displayName.value).toBe("Alice B.");
    expect(profile.bio).toBe("Updated");

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileUpdated"]);
    const updated = events[0] as unknown as { displayName: string };
    expect(updated.displayName).toBe("Alice B.");
  });

  it("clears the bio when edited with no bio", () => {
    const profile = open();
    const edited = profile.edit({ displayName: "Alice", now: NOW });
    expect(edited.isOk).toBe(true);
    expect(profile.bio).toBeUndefined();
  });

  it("rejects an invalid display name and emits nothing", () => {
    const profile = open();
    const edited = profile.edit(editProps({ displayName: "" }));
    expect(edited.isErr).toBe(true);
    if (edited.isErr) expect(edited.error.code).toBe("InvalidDisplayName");
    expect(profile.pullEvents()).toHaveLength(0);
    expect(profile.displayName.value).toBe("Alice"); // unchanged
  });

  it("round-trips through toState/rehydrate without re-emitting events", () => {
    const profile = open();
    const rehydrated = Profile.rehydrate(profile.toState());
    expect(rehydrated.displayName.value).toBe("Alice");
    expect(rehydrated.memberId).toBe(member);
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});
