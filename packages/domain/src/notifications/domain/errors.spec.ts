import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { NotificationError } from "./errors";
import { MemberId, NotificationId } from "./ids";

const id = toId<"NotificationId">("ntf1") as NotificationId;
const bob = toId<"MemberId">("bob") as MemberId;

describe("NotificationError", () => {
  it("notOwner carries the NotNotificationOwner code and a descriptive message", () => {
    const error = NotificationError.notOwner(id, bob);
    expect(error.code).toBe("NotNotificationOwner");
    expect(error.name).toBe("NotificationError");
    expect(error.message).toContain("bob");
    expect(error.message).toContain("ntf1");
  });
});
