import { describe, expect, it } from "vitest";
import { ALLOWED_PROPOSAL_TRANSITIONS } from "./proposal-status";

describe("ALLOWED_PROPOSAL_TRANSITIONS", () => {
  it("only pending has outgoing moves; every other status is terminal", () => {
    expect(ALLOWED_PROPOSAL_TRANSITIONS).toEqual({
      pending: ["approved", "rejected", "withdrawn"],
      approved: [],
      rejected: [],
      withdrawn: [],
    });
  });
});
