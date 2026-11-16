import { describe, expect, it } from "vitest";
import * as contracts from "../index";

describe("contracts barrel", () => {
  it("exports no zod runtime schemas (nothing parses with them)", () => {
    expect(contracts).not.toHaveProperty("paginationInput");
    expect(contracts).not.toHaveProperty("memberStatsView");
    expect(contracts).not.toHaveProperty("globalStatsView");
  });
});
