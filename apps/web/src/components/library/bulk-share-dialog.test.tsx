// @vitest-environment happy-dom
import type { CircleSummaryView } from "@jigswap/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { BulkShareDialog } from "./bulk-share-dialog";

// The bulk "Share with circle" picker lists the member's circles, won't let a View only seat share,
// says beforehand what stays out or stays unseen, stays open while the share runs, and points to
// Circles when there is nothing to pick.

const queryData = vi.hoisted(() => ({
  circles: undefined as unknown,
  isError: false,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: queryData.circles, isError: queryData.isError }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const circle = (extra: Partial<CircleSummaryView>): CircleSummaryView =>
  ({
    _id: "circle_doc",
    aggregateId: "circle_agg",
    name: "Neighbours",
    memberCount: 4,
    isOwnedByViewer: false,
    viewerPermission: "Exchange",
    createdAt: 1,
    ...extra,
  }) as CircleSummaryView;

const renderDialog = (
  props: Partial<ComponentProps<typeof BulkShareDialog>> = {},
  { locale = "en", messages = en as object } = {},
) => {
  const onOpenChange = vi.fn();
  const onPick = vi.fn(async () => {});
  render(
    <IntlProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Amsterdam"
    >
      <BulkShareDialog
        open
        onOpenChange={onOpenChange}
        count={3}
        housemates={0}
        hidden={0}
        onPick={onPick}
        {...props}
      />
    </IntlProvider>,
  );
  return { onOpenChange, onPick };
};

afterEach(() => {
  cleanup();
  queryData.circles = undefined;
  queryData.isError = false;
});

describe("BulkShareDialog", () => {
  it("lists the member's circles and shares with the one picked", () => {
    const neighbours = circle({ _id: "a", name: "Neighbours" });
    queryData.circles = [neighbours];
    const { onPick } = renderDialog();
    expect(screen.getByText("Choose a circle for 3 puzzles.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Neighbours/ }));
    expect(onPick).toHaveBeenCalledWith(neighbours);
  });

  it("won't let a View only seat share, and says so on the row", () => {
    queryData.circles = [
      circle({ _id: "v", name: "Family", viewerPermission: "ViewOnly" }),
    ];
    const { onPick } = renderDialog();
    const row = screen.getByRole("button", {
      name: /Family/,
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(screen.getByText("View only: you can't share here")).toBeTruthy();
    fireEvent.click(row);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("leaves out a circle from before the domain backfill, which can't take shares", () => {
    queryData.circles = [
      circle({ _id: "l", name: "Legacy", aggregateId: undefined }),
      circle({ _id: "a", name: "Neighbours" }),
    ];
    renderDialog();
    expect(screen.queryByRole("button", { name: /Legacy/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Neighbours/ })).toBeTruthy();
  });

  it("says beforehand what stays out and what circle members won't see", () => {
    queryData.circles = [circle({})];
    renderDialog({ count: 3, housemates: 2, hidden: 1 });
    expect(
      screen.getByText(
        "2 belong to household members. Only the owner can share a puzzle.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "1 isn't on offer, so circle members won't see it until you offer it.",
      ),
    ).toBeTruthy();
  });

  it("offers no circle when the selection holds nothing the member can share", () => {
    queryData.circles = [circle({})];
    renderDialog({ count: 0, housemates: 2 });
    expect(
      screen.getByText("There's nothing here you can share."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Neighbours/ })).toBeNull();
  });

  it("stays open with its choices disabled until the share has finished, then closes", async () => {
    const neighbours = circle({ _id: "a", name: "Neighbours" });
    queryData.circles = [neighbours, circle({ _id: "b", name: "Club" })];
    let finish = () => {};
    const onPick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { onOpenChange } = renderDialog({ onPick });

    fireEvent.click(screen.getByRole("button", { name: /Neighbours/ }));
    const club = (await screen.findByRole("button", {
      name: /Club/,
    })) as HTMLButtonElement;
    expect(club.disabled).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("points to Circles when the member is in none", () => {
    queryData.circles = [];
    renderDialog();
    expect(screen.getByText("You're not in any circle yet.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Go to Circles" }).getAttribute("href"),
    ).toBe("/circles");
  });

  it("says when the circles couldn't be loaded", () => {
    queryData.isError = true;
    renderDialog();
    expect(screen.getByText("Couldn't load your circles.")).toBeTruthy();
  });

  it("speaks Dutch", () => {
    queryData.circles = [circle({})];
    renderDialog(
      { count: 1, housemates: 1, hidden: 2 },
      { locale: "nl", messages: nl },
    );
    expect(screen.getByText("Kies een kring voor 1 puzzel.")).toBeTruthy();
    expect(
      screen.getByText(
        "1 is van een huisgenoot. Alleen de eigenaar kan een puzzel delen.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "2 worden niet aangeboden, dus kringleden zien ze pas als je ze aanbiedt.",
      ),
    ).toBeTruthy();
  });
});
