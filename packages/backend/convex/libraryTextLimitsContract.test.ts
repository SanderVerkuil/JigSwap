import {
  MAX_SOLVE_NOTES_LENGTH as CONTRACT_SOLVE_NOTES,
  LIBRARY_TEXT_LIMITS as CONTRACT_TEXT_LIMITS,
} from "@jigswap/contracts";
import { LIBRARY_TEXT_LIMITS, MAX_SOLVE_NOTES_LENGTH } from "@jigswap/domain";
import { expect, test } from "vitest";

// The web forms' maxLength come from @jigswap/contracts, what the server refuses from the domain.
test("the bounds the forms use are the bounds the server enforces", () => {
  expect(CONTRACT_TEXT_LIMITS).toEqual(LIBRARY_TEXT_LIMITS);
  expect(CONTRACT_SOLVE_NOTES).toBe(MAX_SOLVE_NOTES_LENGTH);
});
