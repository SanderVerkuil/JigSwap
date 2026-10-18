// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { createTranslator, IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { DeleteCircleAction } from "./delete-circle-action";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const DELETE = getFunctionName(gateway.sharing.deleteCircle);

const renderAction = (locale: "en" | "nl" = "en") => {
  const onDeleted = vi.fn();
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <DeleteCircleAction
          circleId="circle-1"
          circleName="Saturday Puzzlers"
          onDeleted={onDeleted}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { onDeleted };
};

// Open the confirm and return its parts.
const openConfirm = (trigger: string, label: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: trigger }));
  const dialog = screen.getByRole("alertdialog");
  const input = within(dialog).getByLabelText(label);
  const confirm = within(dialog).getByRole("button", { name: trigger });
  return { dialog, input, confirm: confirm as HTMLButtonElement };
};

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("DeleteCircleAction", () => {
  it("is a labelled destructive trigger, not colour alone", () => {
    renderAction();
    const trigger = screen.getByRole("button", { name: "Delete circle" });
    expect(trigger.className).toContain("text-destructive");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("keeps the confirm disabled until the exact name is typed (nothing trimmed)", () => {
    renderAction();
    const { input, confirm } = openConfirm(
      "Delete circle",
      /Type Saturday Puzzlers to confirm/,
    );
    expect(confirm.disabled).toBe(true);

    for (const near of [
      "Saturday",
      "saturday puzzlers",
      " Saturday Puzzlers",
      "Saturday Puzzlers ",
    ]) {
      fireEvent.change(input, { target: { value: near } });
      expect(confirm.disabled).toBe(true);
    }

    fireEvent.change(input, { target: { value: "Saturday Puzzlers" } });
    expect(confirm.disabled).toBe(false);
  });

  it("deletes with the typed name, toasts and reports back", async () => {
    mocks.mutation.mockResolvedValue(null);
    const { onDeleted } = renderAction();
    const { input, confirm } = openConfirm(
      "Delete circle",
      /Type Saturday Puzzlers to confirm/,
    );
    fireEvent.change(input, { target: { value: "Saturday Puzzlers" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.mutation).toHaveBeenCalledWith(DELETE, {
      circleId: "circle-1",
      confirmName: "Saturday Puzzlers",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Circle deleted");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps the dialog open and says so when the delete fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("boom"));
    const { onDeleted } = renderAction();
    const { input, confirm } = openConfirm(
      "Delete circle",
      /Type Saturday Puzzlers to confirm/,
    );
    fireEvent.change(input, { target: { value: "Saturday Puzzlers" } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't delete the circle. Please try again.",
      ),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("is translated (nl)", () => {
    renderAction("nl");
    const { confirm } = openConfirm(
      "Kring verwijderen",
      /Typ Saturday Puzzlers om te bevestigen/,
    );
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText("Saturday Puzzlers verwijderen?")).toBeTruthy();
  });

  it("carries the approved copy in every catalog", () => {
    const tr = (messages: typeof en, locale: string) =>
      createTranslator({ locale, messages, namespace: "circles" });
    expect(tr(en, "en")("deleteConfirmTitle", { circle: "Family" })).toBe(
      "Delete Family?",
    );
    expect(en.circles.deleteConfirmBody).toBe(
      "This removes the circle for everyone: members, invitations and the puzzles shared in it. Shared puzzles stay in their owners' libraries. This can't be undone.",
    );
    expect(nl.circles.deleteConfirmBody).toBe(
      "Hiermee verdwijnt de kring voor iedereen: leden, uitnodigingen en de puzzels die erin gedeeld zijn. Gedeelde puzzels blijven in de bibliotheek van hun eigenaar. Dit kan niet ongedaan worden gemaakt.",
    );
    expect(nl.circles.deleted).toBe("Kring verwijderd");
    expect(source.circles).toEqual(en.circles);
  });
});
