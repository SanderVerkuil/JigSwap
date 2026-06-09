import { describe, expect, it } from "vitest";
import { Username } from "./username";

describe("Username", () => {
  it.each(["abc", "alice_99", "a-b-c", "ABCdef123", "x".repeat(30)])(
    "accepts the valid handle %s",
    (value) => {
      const result = Username.create(value);
      expect(result.isOk).toBe(true);
      if (result.isOk) expect(result.value.value).toBe(value);
    },
  );

  it.each(["ab", "x".repeat(31), "has space", "dot.dot", "emoji😀", ""])(
    "rejects the invalid handle %s",
    (value) => {
      const result = Username.create(value);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidUsername");
    },
  );
});
