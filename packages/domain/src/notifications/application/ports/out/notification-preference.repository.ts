import { MemberId, NotificationPreference } from "../../../domain";

// Outbound port: persistence for the NotificationPreference aggregate (one per member). Keyed by
// member because that is how every flow looks it up; the adapter maps to a per-member row.
export interface NotificationPreferenceRepository {
  findByMember(memberId: MemberId): Promise<NotificationPreference | null>;
  save(preference: NotificationPreference): Promise<void>;
}
