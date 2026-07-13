import {
  Clock,
  DomainEvent,
  DomainEventPublisher,
  ok,
  Result,
} from "../../../shared-kernel";
import {
  Channel,
  CHANNELS,
  MemberId,
  Notification,
  NotificationId,
  NotificationPreference,
} from "../../domain";
import {
  NotifyMember,
  NotifyMemberCommand,
} from "../ports/in/notify-member.port";
import { NotificationDelivery } from "../ports/out/notification-delivery.port";
import { NotificationIdGenerator } from "../ports/out/notification-id-generator";
import { NotificationPreferenceIdGenerator } from "../ports/out/notification-preference-id-generator";
import { NotificationPreferenceRepository } from "../ports/out/notification-preference.repository";

export interface NotifyMemberDeps {
  readonly delivery: NotificationDelivery;
  readonly preferences: NotificationPreferenceRepository;
  readonly notificationIds: NotificationIdGenerator;
  readonly preferenceIds: NotificationPreferenceIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// The key entry the backend subscriber calls. This is the POLICY SEAM that makes Notifications a
// pure subscriber: it loads the member's preference (or a default if none stored), then for each
// candidate channel allowed by that preference, creates and saves a Notification. If the member
// has suppressed every channel for this type, it is a legitimate no-op (ok with an empty array).
//
// Notifications never fails here — there is no upstream contract to break; an unwanted event is
// simply not materialised. Hence the `never` error channel.
export const makeNotifyMember =
  (deps: NotifyMemberDeps): NotifyMember =>
  async (
    cmd: NotifyMemberCommand,
  ): Promise<Result<readonly NotificationId[], never>> => {
    const preference = await loadPreference(deps, cmd.memberId);

    const candidates: readonly Channel[] = cmd.channels ?? CHANNELS;
    const allowed = candidates.filter((channel) =>
      preference.allows(cmd.type, channel),
    );

    const created: NotificationId[] = [];
    const pending: DomainEvent[] = [];
    const now = deps.clock.now();

    for (const channel of allowed) {
      const notification = Notification.create({
        id: deps.notificationIds.next(),
        userId: cmd.memberId,
        type: cmd.type,
        title: cmd.title,
        message: cmd.message,
        params: cmd.params,
        relatedId: cmd.relatedId,
        channel,
        now,
      });
      // Delivery owns the medium: in-app persists, email/push dispatch out-of-band. The use case
      // stays oblivious to which, and must NOT also persist or in-app rows would double-write.
      await deps.delivery.deliver(channel, notification);
      created.push(notification.id);
      pending.push(...notification.pullEvents());
    }

    if (pending.length > 0) {
      await deps.events.publish(pending);
    }
    return ok(created);
  };

// Load the member's stored preference, or materialise (and persist) the sensible default so a
// member who never visited their settings still receives the default in-app deliveries.
const loadPreference = async (
  deps: NotifyMemberDeps,
  memberId: MemberId,
): Promise<NotificationPreference> => {
  const existing = await deps.preferences.findByMember(memberId);
  if (existing) return existing;

  const fresh = NotificationPreference.createDefault(
    deps.preferenceIds.next(),
    memberId,
    deps.clock.now(),
  );
  await deps.preferences.save(fresh);
  return fresh;
};
