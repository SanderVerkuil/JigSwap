// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./new";

// UX-176: /messages/new only means something with ?copy=<id> (a copy's
// "Message" action); without it the URL is stale or hand-typed.

type BeforeLoad = NonNullable<typeof Route.options.beforeLoad>;

const runBeforeLoad = (search: { copy?: string }): unknown => {
  try {
    Route.options.beforeLoad?.({ search } as Parameters<BeforeLoad>[0]);
    return undefined;
  } catch (thrown) {
    return thrown;
  }
};

describe("/messages/new beforeLoad", () => {
  it("redirects to the inbox, replacing the history entry, without a copy", () => {
    const thrown = runBeforeLoad({});
    expect(isRedirect(thrown)).toBe(true);
    if (!isRedirect(thrown)) return;
    expect(thrown.options.to).toBe("/messages");
    expect(thrown.options.replace).toBe(true);
  });

  it("lets a copy's message link through", () => {
    expect(runBeforeLoad({ copy: "copy_1" })).toBeUndefined();
  });
});
