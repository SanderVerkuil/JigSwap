import { Result } from "../../../../shared-kernel";
import { Channel, MemberId, NotificationType } from "../../../domain";

// One (type, channel) toggle inside a bulk update.
export interface PreferenceUpdate {
  readonly type: NotificationType;
  readonly channel: Channel;
  readonly enabled: boolean;
}

// The bulk command behind the preference matrix's category toggle-all controls: the whole batch
// applies against ONE loaded aggregate and ONE save, so a header click is atomic.
export interface UpdateNotificationPreferencesCommand {
  readonly memberId: MemberId;
  readonly updates: readonly PreferenceUpdate[];
}

// Inbound port: the bulk update-notification-preferences use case.
export interface UpdateNotificationPreferences {
  (cmd: UpdateNotificationPreferencesCommand): Promise<Result<void, never>>;
}
