import { Result } from "../../../../shared-kernel";
import {
  Channel,
  MemberId,
  NotificationId,
  NotificationType,
} from "../../../domain";

// The command the backend subscriber calls after translating an upstream domain event into a
// notification request. `params` carries render-ready values (e.g. actorName, puzzleTitle) for this
// type's copy; rendering happens at the edges (web, email), not in Notifications (Notifications owns
// delivery + preferences, not copywriting policy of other contexts). `title`/`message` are
// transitional legacy pre-rendered copy, kept until the backend subscriber emits params instead.
// `channels` optionally narrows the fan-out to a subset; omitted ⇒ consider all channels, gated by
// the member's preference.
export interface NotifyMemberCommand {
  readonly memberId: MemberId;
  readonly type: NotificationType;
  readonly title?: string;
  readonly message?: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly relatedId?: string;
  readonly channels?: readonly Channel[];
}

// Inbound port: the notify-member use case. Returns the ids of the notifications actually created
// (one per allowed channel); an empty array means the member's preferences suppressed all channels
// (a legitimate no-op, not an error).
export interface NotifyMember {
  (cmd: NotifyMemberCommand): Promise<Result<readonly NotificationId[], never>>;
}
