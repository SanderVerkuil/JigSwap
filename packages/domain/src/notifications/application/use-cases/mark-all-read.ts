import { Clock, DomainEvent, DomainEventPublisher, ok, Result } from "../../../shared-kernel";
import { MarkAllRead, MarkAllReadCommand } from "../ports/in/mark-all-read.port";
import { NotificationRepository } from "../ports/out/notification.repository";

export interface MarkAllReadDeps {
  readonly notifications: NotificationRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Bulk-mark a member's unread notifications. The repository returns the affected aggregates with
// their NotificationRead events already recorded (markAllReadForUser only touches unread ones);
// we drain and publish those events and report the count. No ownership check is needed because the
// scan is scoped to the member by construction.
export const makeMarkAllRead =
  (deps: MarkAllReadDeps): MarkAllRead =>
  async (cmd: MarkAllReadCommand): Promise<Result<number, never>> => {
    const affected = await deps.notifications.markAllReadForUser(cmd.memberId, deps.clock.now());

    const pending: DomainEvent[] = [];
    for (const notification of affected) {
      pending.push(...notification.pullEvents());
    }
    if (pending.length > 0) {
      await deps.events.publish(pending);
    }
    return ok(affected.length);
  };
