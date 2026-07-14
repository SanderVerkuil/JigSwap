import { describe, expect, it, vi } from "vitest";
import { isViewingMessages } from "./notifications/presenceGate";

const ctx = {} as never;

describe("isViewingMessages", () => {
  it("true when the user is online in the messages room", async () => {
    const lister = vi
      .fn()
      .mockResolvedValue([
        { roomId: "messages", online: true, lastDisconnected: 0 },
      ]);
    expect(await isViewingMessages(ctx, "user-1", lister)).toBe(true);
  });

  it("false when online only in other rooms or offline", async () => {
    const lister = vi
      .fn()
      .mockResolvedValue([
        { roomId: "other", online: true, lastDisconnected: 0 },
      ]);
    expect(await isViewingMessages(ctx, "user-1", lister)).toBe(false);
    const offline = vi.fn().mockResolvedValue([]);
    expect(await isViewingMessages(ctx, "user-1", offline)).toBe(false);
  });

  it("fails open: a presence error means NOT viewing (deliver notifications)", async () => {
    const boom = vi.fn().mockRejectedValue(new Error("component down"));
    expect(await isViewingMessages(ctx, "user-1", boom)).toBe(false);
  });
});
