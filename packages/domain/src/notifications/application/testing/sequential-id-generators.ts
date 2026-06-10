import {
  toNotificationId,
  toNotificationPreferenceId,
} from "../../../shared-kernel";
import { NotificationId, NotificationPreferenceId } from "../../domain";
import { NotificationIdGenerator } from "../ports/out/notification-id-generator";
import { NotificationPreferenceIdGenerator } from "../ports/out/notification-preference-id-generator";

// Deterministic NotificationIdGenerator for tests: ntf-1, ntf-2, ...
export class SequentialNotificationIdGenerator implements NotificationIdGenerator {
  private counter = 0;

  next(): NotificationId {
    this.counter += 1;
    return toNotificationId(`ntf-${this.counter}`);
  }
}

// Deterministic NotificationPreferenceIdGenerator for tests: pref-1, pref-2, ...
export class SequentialPreferenceIdGenerator implements NotificationPreferenceIdGenerator {
  private counter = 0;

  next(): NotificationPreferenceId {
    this.counter += 1;
    return toNotificationPreferenceId(`pref-${this.counter}`);
  }
}
