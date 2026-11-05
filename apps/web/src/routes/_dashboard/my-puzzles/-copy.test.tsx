// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./$id";

// The owner's copy page keeps the `?from=collection:<id>` context a collection's card links
// with, so its breadcrumbs lead back to that collection (as the public copy page does).

const mocks = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ id: "copy_doc_1" }),
    useSearch: () => mocks.search,
  }),
}));
vi.mock("@/routes/_dashboard/copies/$id", () => ({
  CopyInstanceScreen: (props: object) => (
    <output data-testid="screen">{JSON.stringify(props)}</output>
  ),
}));

const options = (
  Route as unknown as {
    options: {
      component: ComponentType;
      validateSearch: (search: Record<string, unknown>) => { from?: string };
    };
  }
).options;

const renderWith = (search: Record<string, unknown>) => {
  mocks.search = options.validateSearch(search);
  const Page = options.component;
  render(<Page />);
  return JSON.parse(screen.getByTestId("screen").textContent ?? "{}");
};

afterEach(cleanup);

describe("/my-puzzles/$id", () => {
  it("passes a collection context on to the copy screen", () => {
    expect(renderWith({ from: "collection:col_doc" })).toEqual({
      copyId: "copy_doc_1",
      owned: true,
      navContext: { kind: "collection", id: "col_doc" },
    });
  });

  it("has no context without ?from, or with a malformed one", () => {
    expect(renderWith({}).navContext).toBeNull();
    cleanup();
    expect(renderWith({ from: 42 }).navContext).toBeNull();
  });
});
