import type { MutationCtx } from "../_generated/server";
import { MESSAGES_ROOM, presence } from "../presence";

type RoomEntry = { roomId: string; online: boolean; lastDisconnected: number };
type Lister = (ctx: MutationCtx, userId: string) => Promise<RoomEntry[]>;

const componentLister: Lister = (ctx, userId) =>
  presence.listUser(ctx, userId, true);

// Is this member currently on the messages page? Powers the message_received suppression
// (design spec 2026-07-14): a present recipient gets NO bell/email/push — the open tab's live
// UI + toast is the notification. FAIL-OPEN: any presence hiccup answers "no", because a
// spurious notification beats a silently swallowed one, and a throw here would poison the
// dispatch transaction (retried forever).
export const isViewingMessages = async (
  ctx: MutationCtx,
  userId: string,
  lister: Lister = componentLister,
): Promise<boolean> => {
  try {
    const rooms = await lister(ctx, userId);
    return rooms.some((room) => room.roomId === MESSAGES_ROOM && room.online);
  } catch (error) {
    console.warn(
      `presence check failed (${String(error)}); delivering notifications`,
    );
    return false;
  }
};
