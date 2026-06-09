import {
  type DomainEventPublisher,
  makeNotifyMember,
  type NotifyMember,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { convexNotificationPreferenceRepository } from "./convexNotificationPreferenceRepository";
import { convexNotificationDelivery } from "./notificationDelivery";
import {
  notificationIdGenerator,
  notificationPreferenceIdGenerator,
} from "./idGenerators";
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
export const makeNotify = (ctx: MutationCtx): NotifyMember =>
  makeNotifyMember({
    delivery: convexNotificationDelivery(ctx),
    preferences: convexNotificationPreferenceRepository(ctx),
    notificationIds: notificationIdGenerator,
    preferenceIds: notificationPreferenceIdGenerator,
    events: noopEventPublisher,
    clock: systemClock,
  });
