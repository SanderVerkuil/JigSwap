import { Result } from "../../../../shared-kernel";
import { Channel, MemberId, NotificationId, NotificationType } from "../../../domain";

// The command the backend subscriber calls after translating an upstream domain event into a
// notification request. The subscriber pre-renders `title`/`message` (Notifications owns delivery
// + preferences, not copywriting policy of other contexts). `channels` optionally narrows the
// fan-out to a subset; omitted ⇒ consider all channels, gated by the member's preference.
export interface NotifyMemberCommand {
  readonly memberId: MemberId;
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
  readonly relatedId?: string;
  readonly channels?: readonly Channel[];
}

// Inbound port: the notify-member use case. Returns the ids of the notifications actually created
// (one per allowed channel); an empty array means the member's preferences suppressed all channels
// (a legitimate no-op, not an error).
export interface NotifyMember {
  (cmd: NotifyMemberCommand): Promise<Result<readonly NotificationId[], never>>;
}
