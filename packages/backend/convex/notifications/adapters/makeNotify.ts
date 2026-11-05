import {
  makeNotifyMember,
  ok,
  type DomainEventPublisher,
  type NotifyMember,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { isActiveMember } from "../../identity/requireActiveMember";
import { convexNotificationPreferenceRepository } from "./convexNotificationPreferenceRepository";
import {
  notificationIdGenerator,
  notificationPreferenceIdGenerator,
} from "./idGenerators";
import { convexNotificationDelivery } from "./notificationDelivery";
import { systemClock } from "./systemClock";

// Notifications' OWN events (NotificationCreated/Read, PreferenceChanged) have no further
// subscriber and must NOT loop back through the durable dispatcher, so they are dropped here. This
// keeps Notifications a leaf in the event graph (no infinite record->dispatch->notify recursion).
const noopEventPublisher: DomainEventPublisher = {
  async publish(): Promise<void> {
    /* leaf context: nothing downstream consumes Notifications' own events. */
  },
};

// Build the notify-member use case wired to the Convex Notifications adapters. The use case
// consults the member's preference per channel, so this is the one place that enforces suppression.
// A recipient who is not an active member (account deleted, or deactivated by a CSAM tombstone)
// gets nothing, as if every channel were off: delivering would recreate the notification and
// preference rows account deletion purged.
export const makeNotify = (ctx: MutationCtx): NotifyMember => {
  const notifyMember = makeNotifyMember({
    delivery: convexNotificationDelivery(ctx),
    preferences: convexNotificationPreferenceRepository(ctx),
    notificationIds: notificationIdGenerator,
    preferenceIds: notificationPreferenceIdGenerator,
    events: noopEventPublisher,
    clock: systemClock,
  });
  return async (cmd) =>
    (await isActiveMember(ctx, cmd.memberId)) ? notifyMember(cmd) : ok([]);
};
