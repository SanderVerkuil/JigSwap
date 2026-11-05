// @vitest-environment happy-dom
import type { CollectionView } from "@jigswap/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { AddToCollectionDialog } from "./add-to-collection-dialog";

// The bulk "Add to collection" picker lists the member's collections (never a wishlist, which holds
// wished puzzles, not copies), stays open while the add runs, and points to Collections when there
// is nothing to pick.

const queryData = vi.hoisted(() => ({
  collections: undefined as unknown,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: queryData.collections }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const collection = (extra: Partial<CollectionView>): CollectionView =>
  ({
    _id: "col_doc",
    aggregateId: "col_agg",
    name: "Holiday",
    puzzleCount: 2,
    isWishlist: false,
    ...extra,
  }) as CollectionView;

const renderDialog = (
  props: Partial<ComponentProps<typeof AddToCollectionDialog>> = {},
) => {
  const onOpenChange = vi.fn();
  const onPick = vi.fn(async () => {});
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <AddToCollectionDialog
        open
        onOpenChange={onOpenChange}
        count={3}
        onPick={onPick}
        {...props}
      />
    </IntlProvider>,
  );
  return { onOpenChange, onPick };
};

afterEach(() => {
  cleanup();
  queryData.collections = undefined;
});

describe("AddToCollectionDialog", () => {
  it("lists the member's collections and leaves out the wishlist", () => {
    queryData.collections = [
      collection({ _id: "a", name: "Holiday" }),
      collection({ _id: "w", name: "Wishlist", isWishlist: true }),
    ];
    renderDialog();
    expect(screen.getByText("Choose a collection for 3 puzzles.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Holiday/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Wishlist/ })).toBeNull();
  });

  it("stays open with its choices disabled until the add has finished, then closes", async () => {
    const holiday = collection({ _id: "a", name: "Holiday" });
    queryData.collections = [holiday, collection({ _id: "b", name: "Attic" })];
    let finish = () => {};
    const onPick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { onOpenChange } = renderDialog({ onPick });

    fireEvent.click(screen.getByRole("button", { name: /Holiday/ }));
    expect(onPick).toHaveBeenCalledWith(holiday);
    const attic = (await screen.findByRole("button", {
      name: /Attic/,
    })) as HTMLButtonElement;
    expect(attic.disabled).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("points to Collections when the member has none to pick", () => {
    queryData.collections = [
      collection({ _id: "w", name: "Wishlist", isWishlist: true }),
    ];
    renderDialog();
    expect(screen.getByText("You don't have a collection yet.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Create a collection" })
        .getAttribute("href"),
    ).toBe("/collections");
  });
});
