import { NotificationId } from "../../../domain";

// Outbound port: minting a new NotificationId. The aggregate's `create` takes its id as input (it
// is pure and does no I/O), so the use case obtains one here. The 4a-backend adapter can back this
// with a pre-inserted document id or a uuid.
export interface NotificationIdGenerator {
  next(): NotificationId;
}
