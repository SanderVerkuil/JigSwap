// Which inbox threads announce a new message with an in-tab toast (the
// /messages layout's watcher), kept pure so it unit-tests without React.
import type { AnyInboxThread } from "./format";

/**
 * The threads of `inbox` whose newest message arrived since the watcher's
 * last look (`previous`: thread id -> newest message instant), and what it
 * should remember now. Nothing toasts on the first look, so opening /messages
 * never toast-storms the inbox. A message toasts only when someone else wrote
 * it, it isn't a system line (mirroring the backend's MessagePosted guard),
 * the thread isn't muted or open, and its author isn't blocked by the viewer.
 *
 * The inbox is its newest page only. A new message lifts its thread into the
 * page; a thread can also slide in from below when one above it leaves the
 * page. So a thread new to the page toasts only when its message is newer than
 * any the watcher saw, which a slid-in (older) thread never is.
 */
export function threadsToToast(
  inbox: readonly AnyInboxThread[],
  previous: ReadonlyMap<string, number> | null,
  activeThreadId: string | undefined,
): { toToast: AnyInboxThread[]; seen: Map<string, number> } {
  const newestSeen = previous ? Math.max(0, ...previous.values()) : 0;
  const seen = new Map<string, number>();
  const toToast: AnyInboxThread[] = [];
  for (const thread of inbox) {
    const stamp = thread.lastMessage?.sentAt ?? 0;
    seen.set(thread.threadId, stamp);
    if (
      previous &&
      thread.lastMessage &&
      thread.lastMessage.kind !== "system" &&
      !thread.lastMessage.isMine &&
      !thread.muted &&
      !thread.lastMessage.authorBlockedByMe &&
      thread.threadId !== activeThreadId &&
      stamp > (previous.get(thread.threadId) ?? newestSeen)
    ) {
      toToast.push(thread);
    }
  }
  return { toToast, seen };
}
