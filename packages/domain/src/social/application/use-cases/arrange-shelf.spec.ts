import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId, toProfileId } from "../../../shared-kernel";
import { Profile } from "../../domain";
import {
  FixedClock,
  InMemoryProfileRepository,
  RecordingEventPublisher,
} from "../testing";
import { makeArrangeShelf } from "./arrange-shelf";

const alice = toMemberId("alice");
const bob = toMemberId("bob");
const profileId = toProfileId("profile-1");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("makeArrangeShelf", () => {
  let profiles: InMemoryProfileRepository;
  let events: RecordingEventPublisher;
  let arrangeShelf: ReturnType<typeof makeArrangeShelf>;

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
    arrangeShelf = makeArrangeShelf({
      profiles,
      events,
      clock: new FixedClock(NOW),
    });
  });

  it("saves the ordered featuredCopyIds and publishes ProfileShelfArranged", async () => {
    await seedProfile();

    const result = await arrangeShelf({
      memberId: alice,
      copyIds: ["copy-1", "copy-2", "copy-3"],
    });

    expect(result.isOk).toBe(true);
    const stored = await profiles.findByMember(alice);
    expect(stored?.featuredCopyIds).toEqual(["copy-1", "copy-2", "copy-3"]);

    expect(events.names()).toEqual(["ProfileShelfArranged"]);
    const published = events.published[0] as unknown as {
      copyIds: readonly string[];
      occurredAt: Date;
    };
    expect(published.copyIds).toEqual(["copy-1", "copy-2", "copy-3"]);
    expect(published.occurredAt).toEqual(NOW);
  });

  it("clears the shelf when given an empty array", async () => {
    await seedProfile();

    const result = await arrangeShelf({
      memberId: alice,
      copyIds: [],
    });

    expect(result.isOk).toBe(true);
    const stored = await profiles.findByMember(alice);
    expect(stored?.featuredCopyIds).toEqual([]);
    expect(events.names()).toEqual(["ProfileShelfArranged"]);
  });

  it("rejects arranging a shelf for a member without a profile (ProfileNotFound)", async () => {
    const result = await arrangeShelf({
      memberId: bob,
      copyIds: ["copy-1"],
    });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("ProfileNotFound");
    expect(events.published).toHaveLength(0);
  });
});
