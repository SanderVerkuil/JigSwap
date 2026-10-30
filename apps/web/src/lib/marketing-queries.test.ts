import { describe, expect, it } from "vitest";
import { hasSocialProof, SOCIAL_PROOF_MIN_MEMBERS } from "./marketing-queries";

describe("hasSocialProof", () => {
  it("is false while the counts have not loaded", () => {
    expect(hasSocialProof(undefined)).toBe(false);
  });

  it("is false below the member threshold", () => {
    expect(hasSocialProof({ totalUsers: 13 })).toBe(false);
    expect(hasSocialProof({ totalUsers: SOCIAL_PROOF_MIN_MEMBERS - 1 })).toBe(
      false,
    );
  });

  it("is true from the member threshold on", () => {
    expect(hasSocialProof({ totalUsers: SOCIAL_PROOF_MIN_MEMBERS })).toBe(true);
    expect(hasSocialProof({ totalUsers: 4200 })).toBe(true);
  });

  it("keeps the threshold the review recommends", () => {
    expect(SOCIAL_PROOF_MIN_MEMBERS).toBe(50);
  });
});
