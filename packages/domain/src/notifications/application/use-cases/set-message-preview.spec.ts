import { beforeEach, describe, expect, it } from "vitest";
import { toMemberId } from "../../../shared-kernel";
import {
  FixedClock,
  InMemoryNotificationPreferenceRepository,
  SequentialPreferenceIdGenerator,
} from "../testing";
import {
  makeSetMessagePreview,
  SetMessagePreviewDeps,
} from "./set-message-preview";

const alice = toMemberId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");

let preferences: InMemoryNotificationPreferenceRepository;
let deps: SetMessagePreviewDeps;

beforeEach(() => {
  preferences = new InMemoryNotificationPreferenceRepository();
  deps = {
    preferences,
    preferenceIds: new SequentialPreferenceIdGenerator(),
    clock: new FixedClock(NOW),
  };
});

describe("makeSetMessagePreview", () => {
  it("materialises a default preference, then sets the channel", async () => {
    const result = await makeSetMessagePreview(deps)({
      memberId: alice,
      channel: "email",
      enabled: true,
    });

    expect(result.isOk).toBe(true);
    const pref = await preferences.findByMember(alice);
    expect(pref?.resolvedMessagePreviews()).toEqual({
      email: true,
      push: true,
    });
    // The per-type defaults are untouched.
    expect(pref?.allows("message_received", "inApp")).toBe(true);
    expect(pref?.allows("message_received", "email")).toBe(false);
  });

  it("updates an existing preference without touching its toggles", async () => {
    const set = makeSetMessagePreview(deps);
    await set({ memberId: alice, channel: "push", enabled: false });
    await set({ memberId: alice, channel: "email", enabled: true });

    expect(preferences.size()).toBe(1);
    const pref = await preferences.findByMember(alice);
    expect(pref?.resolvedMessagePreviews()).toEqual({
      email: true,
      push: false,
    });
  });
});
