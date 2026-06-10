import { describe, expect, it } from "vitest";
import { toMemberId, toNotificationId } from "../../shared-kernel";
import { NotificationError } from "./errors";

const id = toNotificationId("ntf1");
const bob = toMemberId("bob");

describe("NotificationError", () => {
  it("notOwner carries the NotNotificationOwner code and a descriptive message", () => {
    const error = NotificationError.notOwner(id, bob);
    expect(error.code).toBe("NotNotificationOwner");
    expect(error.name).toBe("NotificationError");
    expect(error.message).toContain("bob");
    expect(error.message).toContain("ntf1");
  });
});
