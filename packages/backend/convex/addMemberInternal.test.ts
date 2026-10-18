import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";

// Members join a circle only by accepting an invite. `sharing/addMember` must never be callable
// from a client again: if it is flipped back to a public mutation, `api` gains it and the
// expect-error directive below fails type-check (the generated `api` type omits internal
// functions).
test("sharing/addMember is internal, never client-callable", () => {
  // @ts-expect-error addMember is an internalMutation, so the public api must not expose it
  void api.sharing.addMember.addMember;
  expect(internal.sharing.addMember.addMember).toBeDefined();
});
