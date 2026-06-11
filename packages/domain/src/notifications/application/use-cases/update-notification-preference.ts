import {
  Clock,
  DomainEventPublisher,
  ok,
  Result,
} from "../../../shared-kernel";
import { NotificationPreference } from "../../domain";
import {
  UpdateNotificationPreference,
  UpdateNotificationPreferenceCommand,
} from "../ports/in/update-notification-preference.port";
import { NotificationPreferenceIdGenerator } from "../ports/out/notification-preference-id-generator";
import { NotificationPreferenceRepository } from "../ports/out/notification-preference.repository";

export interface UpdateNotificationPreferenceDeps {
  readonly preferences: NotificationPreferenceRepository;
  readonly preferenceIds: NotificationPreferenceIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Toggle a single (type, channel) for a member, materialising the default preference first if the
// member has none stored. Delegates enablement (and the no-op-when-unchanged rule) to the
// aggregate, then saves and publishes any PreferenceChanged event.
export const makeUpdateNotificationPreference =
  (deps: UpdateNotificationPreferenceDeps): UpdateNotificationPreference =>
  async (
    cmd: UpdateNotificationPreferenceCommand,
  ): Promise<Result<void, never>> => {
    const now = deps.clock.now();
    const preference =
      (await deps.preferences.findByMember(cmd.memberId)) ??
      NotificationPreference.createDefault(
        deps.preferenceIds.next(),
        cmd.memberId,
        now,
      );

    if (cmd.enabled) {
      preference.enable(cmd.type, cmd.channel, now);
    } else {
      preference.disable(cmd.type, cmd.channel, now);
    }

    await deps.preferences.save(preference);
    await deps.events.publish(preference.pullEvents());
    return ok(undefined);
  };
