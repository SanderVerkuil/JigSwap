// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  DeleteOwnContentButton,
  type OwnContentKind,
} from "./delete-own-content-button";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

const DELETE_COMMENT = getFunctionName(gateway.social.deletePuzzleComment);
const DELETE_REVIEW = getFunctionName(gateway.social.deletePuzzleReview);
const CLEAR_REVIEW_COMMENT = getFunctionName(
  gateway.reputation.clearReviewComment,
);

const wrap = (ui: React.ReactNode, locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        {ui}
      </IntlProvider>
    </QueryClientProvider>,
  );

const PUZZLE = "puzzle-1" as Id<"puzzles">;

const confirmDialog = () => screen.getByRole("alertdialog");

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
});
afterEach(cleanup);

describe("DeleteOwnContentButton", () => {
  it("a compact row trigger is named by its action and asks before deleting", async () => {
    const onDeleted = vi.fn();
    wrap(
      <DeleteOwnContentButton
        kind="comment"
        mutation={gateway.social.deletePuzzleComment}
        args={{ commentId: "comment-1" }}
        onDeleted={onDeleted}
        iconOnly
      />,
    );
    const trigger = screen.getByRole("button", { name: "Delete comment" });
    expect(trigger.textContent).toBe("");

    fireEvent.click(trigger);
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(confirmDialog().textContent).toContain("Delete this comment?");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mocks.mutation).toHaveBeenCalledWith(DELETE_COMMENT, {
      commentId: "comment-1",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Comment deleted");
  });

  it("cancelling the confirm deletes nothing", () => {
    wrap(
      <DeleteOwnContentButton
        kind="review"
        mutation={gateway.social.deletePuzzleReview}
        args={{ puzzleId: PUZZLE }}
        iconOnly
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete my review" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("tells the member when the delete fails and does not report success", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    const onDeleted = vi.fn();
    wrap(
      <DeleteOwnContentButton
        kind="review"
        mutation={gateway.social.deletePuzzleReview}
        args={{ puzzleId: PUZZLE }}
        onDeleted={onDeleted}
        iconOnly
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete my review" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete review" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't delete your review. Please try again.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(DELETE_REVIEW, {
      puzzleId: "puzzle-1",
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("the labelled trigger removes only a partner review's comment and says the stars stay", async () => {
    wrap(
      <DeleteOwnContentButton
        kind="reviewComment"
        mutation={gateway.reputation.clearReviewComment}
        args={{ exchangeId: "exchange-1" }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Remove comment" });
    expect(trigger.textContent).toBe("Remove comment");

    fireEvent.click(trigger);
    expect(confirmDialog().textContent).toContain("Your star ratings stay");
    // The dialog's confirm carries the same label as the trigger behind it.
    fireEvent.click(
      within(confirmDialog()).getByRole("button", { name: "Remove comment" }),
    );

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(CLEAR_REVIEW_COMMENT, {
        exchangeId: "exchange-1",
      }),
    );
  });

  it("is translated into Dutch", () => {
    wrap(
      <DeleteOwnContentButton
        kind="comment"
        mutation={gateway.library.deletePhotoComment}
        args={{ commentId: "comment-1" }}
        iconOnly
      />,
      "nl",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reactie verwijderen" }),
    );
    expect(confirmDialog().textContent).toContain("Deze reactie verwijderen?");
    expect(screen.getByRole("button", { name: "Annuleren" })).toBeTruthy();
  });

  it("every kind has the same keys in every catalog, and source mirrors en", () => {
    const kinds: OwnContentKind[] = ["comment", "review", "reviewComment"];
    for (const kind of kinds) {
      expect(Object.keys(nl.ownContent[kind]).sort()).toEqual(
        Object.keys(en.ownContent[kind]).sort(),
      );
    }
    expect(source.ownContent).toEqual(en.ownContent);
  });
});
