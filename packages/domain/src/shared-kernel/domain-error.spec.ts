import { describe, expect, it } from "vitest";
import { DomainError } from "./domain-error";

describe("DomainError", () => {
  it("is an Error carrying the supplied message and a stable name", () => {
    const error = new DomainError("something went wrong");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("something went wrong");
    expect(error.name).toBe("DomainError");
  });
});
