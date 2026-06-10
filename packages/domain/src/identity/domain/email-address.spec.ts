import { describe, expect, it } from "vitest";
import { EmailAddress } from "./email-address";

describe("EmailAddress", () => {
  it.each([
    "alice@example.com",
    "a.b+tag@sub.domain.co",
    "user_name@host.io",
  ])("accepts the valid address %s", (value) => {
    const result = EmailAddress.create(value);
    expect(result.isOk).toBe(true);
  });

  it("normalises by trimming and lower-casing", () => {
    const result = EmailAddress.create("  Alice@Example.COM  ");
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.value).toBe("alice@example.com");
  });

  it.each([
    "",
    "no-at-sign",
    "missing@dot",
    "@example.com",
    "a@b@c.com",
    "spa ce@x.com",
    "alice@example.com\nevil@b.co", // trailing content after a valid prefix (regex is end-anchored)
  ])(
    "rejects the malformed address %s",
    (value) => {
      const result = EmailAddress.create(value);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidEmail");
    },
  );
});
