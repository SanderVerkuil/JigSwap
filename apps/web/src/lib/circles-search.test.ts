import { describe, expect, it } from "vitest";
import { validateCirclesSearch } from "./circles-search";

describe("/circles search params", () => {
  it("keeps a notification's ?invite=<id> deep link", () => {
    expect(validateCirclesSearch({ invite: "inv_1" })).toEqual({
      invite: "inv_1",
      create: undefined,
    });
  });

  it("drops a non-string invite", () => {
    expect(validateCirclesSearch({ invite: 42 }).invite).toBeUndefined();
  });

  // The router parses ?create=1 as the number 1; a hand-built URL may carry the string or true.
  it.each([1, "1", true, "true"])(
    "opens the create dialog for create=%j",
    (create) => {
      expect(validateCirclesSearch({ create }).create).toBe(true);
    },
  );

  it.each([undefined, 0, "0", false, "yes", "", null, {}])(
    "ignores create=%j",
    (create) => {
      expect(validateCirclesSearch({ create }).create).toBeUndefined();
    },
  );
});
