import { NotificationPreferenceId } from "../../../domain";

// Outbound port: minting a new NotificationPreferenceId, needed when NotifyMember (or the update
// use case) materialises a default preference for a member who has none stored yet.
export interface NotificationPreferenceIdGenerator {
  next(): NotificationPreferenceId;
}
