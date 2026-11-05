// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { describe, expect, it, vi } from "vitest";
import { Route } from "./whats-new";

// The bundled entries come from a build-time virtual module; only the search validator matters.
vi.mock("@/components/whats-new/entries", () => ({ WHATS_NEW_ENTRIES: [] }));

// "Help & guides" (account menu, phone quick sheet) links to /whats-new?tab=guides (UX-91).
const validate = (search: Record<string, unknown>) => {
  const { validateSearch } = Route.options;
  if (typeof validateSearch !== "function") throw new Error("no validator");
  return validateSearch(search);
};

describe("/whats-new search", () => {
  it("opens the Guides tab for the Help & guides link", () => {
    const search = Object.fromEntries(
      new URL("/whats-new?tab=guides", "https://jigswap.site").searchParams,
    );
    expect(validate(search)).toEqual({ tab: "guides" });
  });

  it("falls back to Updates for anything else", () => {
    expect(validate({})).toEqual({ tab: undefined });
    expect(validate({ tab: "updates" })).toEqual({ tab: undefined });
  });
});
