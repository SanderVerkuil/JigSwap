import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toProfileId } from "../../../shared-kernel";
import { Profile } from "../../domain";
import {
  FixedClock,
  InMemoryProfileRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeSetProfileVisibility } from "./set-profile-visibility";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const profileId = toProfileId("profile-1");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeSetProfileVisibility", () => {
  let profiles: InMemoryProfileRepository;
  let events: RecordingEventPublisher;
  let setVisibility: ReturnType<typeof makeSetProfileVisibility>;

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
    setVisibility = makeSetProfileVisibility({
      profiles,
      events,
      clock: new FixedClock(NOW),
    });
  });

  it("sets an existing profile to private: saves it and publishes ProfileVisibilityChanged", async () => {
    await seedProfile();

    const result = await setVisibility({
      memberId: alice,
      visibility: "private",
    });

    expect(result.isOk).toBe(true);
    const stored = await profiles.findByMember(alice);
    expect(stored?.visibility).toBe("private");

    expect(events.names()).toEqual(["ProfileVisibilityChanged"]);
    const published = events.published[0] as unknown as {
      memberId: string;
      visibility: string;
      occurredAt: Date;
    };
    expect(published.memberId).toBe(alice);
    expect(published.visibility).toBe("private");
    expect(published.occurredAt).toEqual(NOW);
  });

  it("sets an existing profile back to public and publishes the public event", async () => {
    await seedProfile();

    const result = await setVisibility({
      memberId: alice,
      visibility: "public",
    });

    expect(result.isOk).toBe(true);
    const stored = await profiles.findByMember(alice);
    expect(stored?.visibility).toBe("public");
    expect(events.names()).toEqual(["ProfileVisibilityChanged"]);
    const published = events.published[0] as unknown as { visibility: string };
    expect(published.visibility).toBe("public");
  });

  it("rejects changing visibility for a member without a profile (ProfileNotFound)", async () => {
    const result = await setVisibility({
      memberId: bob,
      visibility: "private",
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ProfileNotFound");
    expect(events.published).toHaveLength(0);
  });
});
