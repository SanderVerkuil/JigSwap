import { describe, expect, it } from "vitest";
import { toMemberId, toProfileId } from "../../shared-kernel";
import { DisplayName } from "./display-name";
import type { ProfileShelfArranged } from "./events";
import { MemberId, ProfileId } from "./ids";
import { BIO_MAX_LENGTH, EditProps, Profile } from "./profile";

const member = toMemberId("alice");
const profileId = toProfileId("profile-1");
const NOW = new Date("2026-06-08T10:00:00Z");

const editProps = (over: Partial<EditProps> = {}): EditProps => ({
  displayName: "Alice",
  bio: "Loves 1000-piece landscapes",
  now: NOW,
  ...over,
});

describe("Profile.create", () => {
  it("opens a profile and records ProfileUpdated with the trimmed display name", () => {
    const result = Profile.create(
      profileId,
      member,
      editProps({ displayName: "  Alice  " }),
    );
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const profile = result.value;
    expect(profile.displayName?.value).toBe("Alice");
    expect(profile.bio).toBe("Loves 1000-piece landscapes");
    expect(profile.visibility).toBe("public");

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
    const result = Profile.create(
      profileId,
      member,
      editProps({ displayName: "   " }),
    );
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidDisplayName");
  });

  it("rejects an over-long display name or bio", () => {
    const longName = Profile.create(
      profileId,
      member,
      editProps({ displayName: "n".repeat(130_000) }),
    );
    expect(longName.isErr).toBe(true);
    if (longName.isErr) expect(longName.error.code).toBe("InvalidDisplayName");

    const longBio = Profile.create(
      profileId,
      member,
      editProps({ bio: "b".repeat(BIO_MAX_LENGTH + 1) }),
    );
    expect(longBio.isErr).toBe(true);
    if (longBio.isErr) expect(longBio.error.code).toBe("BioTooLong");
  });

  it("trims the bio it opens with", () => {
    const result = Profile.create(
      profileId,
      member,
      editProps({ bio: "  Hi  " }),
    );
    if (!result.isOk) throw new Error("setup");
    expect(result.value.bio).toBe("Hi");
  });

  it("opens a profile without a display name when the member has none (it stays optional)", () => {
    const result = Profile.create(profileId, member, { now: NOW });
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const profile = result.value;
    expect(profile.displayName).toBeUndefined();
    const updated = profile.pullEvents()[0] as unknown as {
      displayName?: string;
    };
    expect(updated.displayName).toBeUndefined();
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
    const edited = profile.edit(
      editProps({ displayName: "Alice B.", bio: "Updated" }),
    );
    expect(edited.isOk).toBe(true);
    expect(profile.displayName?.value).toBe("Alice B.");
    expect(profile.bio).toBe("Updated");

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileUpdated"]);
    const updated = events[0] as unknown as { displayName: string };
    expect(updated.displayName).toBe("Alice B.");
  });

  it("keeps the current display name when an edit omits it (bio-only save)", () => {
    const profile = open();
    const edited = profile.edit({ bio: "Only the story", now: NOW });
    expect(edited.isOk).toBe(true);
    expect(profile.displayName?.value).toBe("Alice");
    expect(profile.bio).toBe("Only the story");
  });

  it("allows a bio-only save on a profile that has no display name", () => {
    const created = Profile.create(profileId, member, { now: NOW });
    if (!created.isOk) throw new Error("setup");
    const edited = created.value.edit({ bio: "Hi", now: NOW });
    expect(edited.isOk).toBe(true);
    expect(created.value.displayName).toBeUndefined();
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
    expect(profile.displayName?.value).toBe("Alice"); // unchanged
  });

  it("trims the bio and clears it when nothing is left", () => {
    const profile = open();
    expect(profile.edit({ bio: "  Hi there \n", now: NOW }).isOk).toBe(true);
    expect(profile.bio).toBe("Hi there");
    expect(profile.edit({ bio: "   ", now: NOW }).isOk).toBe(true);
    expect(profile.bio).toBeUndefined();
  });

  it("accepts a bio of exactly BIO_MAX_LENGTH and rejects a longer one", () => {
    const profile = open();
    const atCap = "b".repeat(BIO_MAX_LENGTH);
    expect(profile.edit({ bio: atCap, now: NOW }).isOk).toBe(true);
    expect(profile.bio).toBe(atCap);

    profile.pullEvents();
    const edited = profile.edit({ bio: `${atCap}b`, now: NOW });
    expect(edited.isErr).toBe(true);
    if (edited.isErr) expect(edited.error.code).toBe("BioTooLong");
    expect(profile.bio).toBe(atCap); // unchanged
    expect(profile.pullEvents()).toHaveLength(0);
  });

  it("caps the bio at 500 characters", () => {
    expect(BIO_MAX_LENGTH).toBe(500);
  });

  // A profile stored before the caps existed keeps working: resending the current values (the
  // display-name dialog sends the loaded bio back unchanged) is not a new over-long write.
  const legacy = (): Profile =>
    Profile.rehydrate({
      id: profileId,
      memberId: member,
      displayName: DisplayName.fromState("L".repeat(120)),
      bio: "B".repeat(2000),
      visibility: "public",
      featuredCopyIds: [],
      updatedAt: NOW,
    });

  it("accepts an unchanged over-long legacy bio and display name", () => {
    const profile = legacy();
    const edited = profile.edit({
      displayName: "L".repeat(120),
      bio: "B".repeat(2000),
      now: NOW,
    });
    expect(edited.isOk).toBe(true);
    expect(profile.displayName?.value).toBe("L".repeat(120));
    expect(profile.bio).toBe("B".repeat(2000));
  });

  it("keeps a legacy over-long display name on a bio-only save", () => {
    const profile = legacy();
    expect(profile.edit({ bio: "Short now", now: NOW }).isOk).toBe(true);
    expect(profile.displayName?.value).toBe("L".repeat(120));
    expect(profile.bio).toBe("Short now");
  });

  it("refuses a changed bio that is still over the cap on a legacy profile", () => {
    const profile = legacy();
    const edited = profile.edit({ bio: "C".repeat(2000), now: NOW });
    expect(edited.isErr).toBe(true);
    if (edited.isErr) expect(edited.error.code).toBe("BioTooLong");
  });

  it("refuses a changed display name over the cap on a legacy profile", () => {
    const profile = legacy();
    const edited = profile.edit({ displayName: "M".repeat(120), now: NOW });
    expect(edited.isErr).toBe(true);
    if (edited.isErr) expect(edited.error.code).toBe("InvalidDisplayName");
  });

  it("round-trips through toState/rehydrate without re-emitting events", () => {
    const profile = open();
    const rehydrated = Profile.rehydrate(profile.toState());
    expect(rehydrated.id).toBe(profileId);
    expect(rehydrated.displayName?.value).toBe("Alice");
    expect(rehydrated.memberId).toBe(member);
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});

describe("Profile.changeVisibility", () => {
  const LATER = new Date("2026-06-09T12:00:00Z");

  const open = (): Profile => {
    const result = Profile.create(profileId, member, editProps());
    if (!result.isOk) throw new Error("setup");
    result.value.pullEvents(); // discard the creation event
    return result.value;
  };

  it("defaults to public on a freshly created profile", () => {
    const profile = open();
    expect(profile.visibility).toBe("public");
  });

  it("changes public -> private, sets updatedAt, and emits ProfileVisibilityChanged", () => {
    const profile = open();
    const changed = profile.changeVisibility("private", LATER);

    expect(changed.isOk).toBe(true);
    expect(profile.visibility).toBe("private");
    expect(profile.toState().updatedAt).toEqual(LATER);

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileVisibilityChanged"]);
    const event = events[0] as unknown as {
      profileId: ProfileId;
      memberId: MemberId;
      visibility: string;
      occurredAt: Date;
    };
    expect(event.profileId).toBe(profileId);
    expect(event.memberId).toBe(member);
    expect(event.visibility).toBe("private");
    expect(event.occurredAt).toEqual(LATER);
  });

  it("changes private -> public again, emitting a public event", () => {
    const profile = open();
    profile.changeVisibility("private", NOW);
    profile.pullEvents(); // discard the first change

    const changed = profile.changeVisibility("public", LATER);
    expect(changed.isOk).toBe(true);
    expect(profile.visibility).toBe("public");

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileVisibilityChanged"]);
    const event = events[0] as unknown as { visibility: string };
    expect(event.visibility).toBe("public");
  });

  it("leaves the display name and bio untouched when visibility changes", () => {
    const profile = open();
    profile.changeVisibility("private", LATER);
    expect(profile.displayName?.value).toBe("Alice");
    expect(profile.bio).toBe("Loves 1000-piece landscapes");
  });
});

describe("Profile.arrangeShelf", () => {
  const LATER = new Date("2026-06-09T12:00:00Z");

  const open = (): Profile => {
    const result = Profile.create(profileId, member, editProps());
    if (!result.isOk) throw new Error("setup");
    result.value.pullEvents(); // discard the creation event
    return result.value;
  };

  it("sets featuredCopyIds in the given order and records a ProfileShelfArranged event", () => {
    const profile = open();
    const result = profile.arrangeShelf(["a", "b", "c"], LATER);

    expect(result.isOk).toBe(true);
    expect(profile.featuredCopyIds).toEqual(["a", "b", "c"]);

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileShelfArranged"]);
    const event = events[0] as unknown as ProfileShelfArranged;
    expect(event.profileId).toBe(profileId);
    expect(event.memberId).toBe(member);
    expect(event.copyIds).toEqual(["a", "b", "c"]);
    expect(event.occurredAt).toEqual(LATER);
  });

  it("de-duplicates, preserving first-occurrence order", () => {
    const profile = open();
    profile.arrangeShelf(["a", "b", "a"], LATER);
    expect(profile.featuredCopyIds).toEqual(["a", "b"]);
  });

  it("caps at MAX_FEATURED (6) — an 8-item input keeps the first 6", () => {
    const profile = open();
    profile.arrangeShelf(["a", "b", "c", "d", "e", "f", "g", "h"], LATER);
    expect(profile.featuredCopyIds).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(profile.featuredCopyIds).toHaveLength(6);
  });

  it("empty array clears the shelf and still records the event", () => {
    const profile = open();
    profile.arrangeShelf(["a", "b"], NOW);
    profile.pullEvents(); // discard first event

    const result = profile.arrangeShelf([], LATER);
    expect(result.isOk).toBe(true);
    expect(profile.featuredCopyIds).toEqual([]);

    const events = profile.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["ProfileShelfArranged"]);
    const event = events[0] as unknown as ProfileShelfArranged;
    expect(event.copyIds).toEqual([]);
  });

  it("sets updatedAt to the passed now", () => {
    const profile = open();
    profile.arrangeShelf(["a"], LATER);
    expect(profile.toState().updatedAt).toEqual(LATER);
  });
});
