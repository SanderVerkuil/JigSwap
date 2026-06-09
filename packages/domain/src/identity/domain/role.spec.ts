import { describe, expect, it } from "vitest";
import { createRole, isRole, ROLES } from "./role";

describe("Role", () => {
  it.each([...ROLES])("accepts the known role %s", (value) => {
    const result = createRole(value);
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value).toBe(value);
  });

  it.each(["owner", "user", "Admin", "", "superuser"])(
    "rejects the unknown role %s",
    (value) => {
      const result = createRole(value);
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("InvalidRole");
    },
  );

  it("narrows a string with the isRole guard", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("nope")).toBe(false);
  });
});
