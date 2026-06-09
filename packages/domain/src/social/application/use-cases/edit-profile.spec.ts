import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import { MemberId, Profile, ProfileId } from "../../domain";
import {
  FixedClock,
  InMemoryProfileRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeEditProfile } from "./edit-profile";

const alice = toId<"MemberId">("alice") as MemberId;
const bob = toId<"MemberId">("bob") as MemberId;
const profileId = toId<"ProfileId">("profile-1") as ProfileId;
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeEditProfile", () => {
  let profiles: InMemoryProfileRepository;
  let events: RecordingEventPublisher;
  let edit: ReturnType<typeof makeEditProfile>;

  const seedProfile = async (): Promise<void> => {
    const created = Profile.create(profileId, alice, {
      displayName: "Alice",
      bio: "Original",
      now: NOW,
    });
    if (!created.isOk) throw new Error("setup");
    created.value.pullEvents(); // not part of this use case's published events
    await profiles.save(created.value);
  };

  beforeEach(() => {
    profiles = new InMemoryProfileRepository();
    events = new RecordingEventPublisher();
    edit = makeEditProfile({ profiles, events, clock: new FixedClock(NOW) });
  });

  it("edits an existing profile: saves it and publishes ProfileUpdated", async () => {
    await seedProfile();

    const result = await edit({ memberId: alice, displayName: "Alice B.", bio: "Updated" });

    expect(result.isOk).toBe(true);
    const stored = await profiles.findByMember(alice);
    expect(stored?.displayName.value).toBe("Alice B.");
    expect(stored?.bio).toBe("Updated");

    expect(events.names()).toEqual(["ProfileUpdated"]);
    const published = events.published[0] as unknown as { displayName: string };
    expect(published.displayName).toBe("Alice B.");
  });

  it("rejects an invalid display name and leaves the stored profile unchanged", async () => {
    await seedProfile();

    const result = await edit({ memberId: alice, displayName: "   " });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDisplayName");
    const stored = await profiles.findByMember(alice);
    expect(stored?.displayName.value).toBe("Alice"); // unchanged
    expect(events.published).toHaveLength(0);
  });

  it("rejects editing a profile that does not exist (ProfileNotFound)", async () => {
    const result = await edit({ memberId: bob, displayName: "Bob" });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ProfileNotFound");
    expect(events.published).toHaveLength(0);
  });
});
