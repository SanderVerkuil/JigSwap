import { describe, expect, it } from "vitest";
import { notificationTypeValidator } from "./notifications/preferenceValidators";
import schema from "./schema";

describe("notification type literals", () => {
  it("schema notifications.type reuses notificationTypeValidator", () => {
    expect(schema.tables.notifications.validator.fields.type).toBe(
      notificationTypeValidator,
    );
  });
});
