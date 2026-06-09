import { Result } from "../../../../shared-kernel";
import { Channel, MemberId, NotificationType } from "../../../domain";

// The command to toggle a single (type, channel) preference for a member. A member with no stored
// preference yet has a default one materialised before the toggle is applied.
export interface UpdateNotificationPreferenceCommand {
  readonly memberId: MemberId;
  readonly type: NotificationType;
  readonly channel: Channel;
  readonly enabled: boolean;
}

// Inbound port: the update-notification-preference use case.
export interface UpdateNotificationPreference {
  (cmd: UpdateNotificationPreferenceCommand): Promise<Result<void, never>>;
}
