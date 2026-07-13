import {
  Clock,
  DomainEventPublisher,
  ok,
  Result,
} from "../../../shared-kernel";
import { NotificationPreference } from "../../domain";
import {
  UpdateNotificationPreferences,
  UpdateNotificationPreferencesCommand,
} from "../ports/in/update-notification-preferences.port";
import { NotificationPreferenceIdGenerator } from "../ports/out/notification-preference-id-generator";
import { NotificationPreferenceRepository } from "../ports/out/notification-preference.repository";

export interface UpdateNotificationPreferencesDeps {
  readonly preferences: NotificationPreferenceRepository;
  readonly preferenceIds: NotificationPreferenceIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Toggle a batch of (type, channel) preferences for a member atomically: materialise the default
// preference first if the member has none stored, apply every update against that ONE loaded
// aggregate, then save once and publish once. This is what makes a category header click atomic
// (no partial category state if something after the first toggle were to fail).
export const makeUpdateNotificationPreferences =
  (deps: UpdateNotificationPreferencesDeps): UpdateNotificationPreferences =>
  async (
    cmd: UpdateNotificationPreferencesCommand,
  ): Promise<Result<void, never>> => {
    const now = deps.clock.now();
    const preference =
      (await deps.preferences.findByMember(cmd.memberId)) ??
      NotificationPreference.createDefault(
        deps.preferenceIds.next(),
        cmd.memberId,
        now,
      );

    for (const update of cmd.updates) {
      if (update.enabled) {
        preference.enable(update.type, update.channel, now);
      } else {
        preference.disable(update.type, update.channel, now);
      }
    }

    await deps.preferences.save(preference);
    await deps.events.publish(preference.pullEvents());
    return ok(undefined);
  };
