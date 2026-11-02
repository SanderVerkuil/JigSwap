import { describe, expect, it } from "vitest";
import { validateProfileSearch } from "./profile-search";

describe("/profile search params", () => {
  it.each(["profile", "link"] as const)("keeps edit=%s", (edit) => {
    expect(validateProfileSearch({ edit })).toEqual({ edit });
  });

  it("drops anything else, so a bare /profile stays clean", () => {
    expect(validateProfileSearch({}).edit).toBeUndefined();
    expect(validateProfileSearch({ edit: "1" }).edit).toBeUndefined();
    expect(validateProfileSearch({ edit: true }).edit).toBeUndefined();
  });
});
