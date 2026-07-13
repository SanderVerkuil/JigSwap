import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
} from "./notification-meta";

describe("NOTIFICATION_CATEGORIES", () => {
  it("covers every notification type exactly once", () => {
    const all = NOTIFICATION_CATEGORIES.flatMap((c) => c.types);
    expect(all.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});
