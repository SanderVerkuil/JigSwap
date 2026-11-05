// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-60: the new-goal dialog offers an explicit Cancel next to Create; Cancel closes the dialog
// and creates nothing.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route } from "./goals";

const mocks = vi.hoisted(() => ({
  createGoal: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "user_1" } }),
}));
vi.mock("@/gateway", () => ({
  gateway: {
    identity: { byClerkId: "byClerkId" },
    solving: { myGoals: "myGoals", createGoal: "createGoal" },
  },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (name: string) => ({ name }),
  useConvexMutation: () => mocks.createGoal,
}));
// A signed-in member with no goals yet: the empty state's Create button opens the dialog.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ name }: { name: string }) => ({
    data: name === "byClerkId" ? { _id: "member_1" } : [],
  }),
  useMutation: ({ mutationFn }: { mutationFn: unknown }) => ({
    mutateAsync: mutationFn,
    isPending: false,
  }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

describe("Goals create dialog", () => {
  it("Cancel closes the dialog without creating a goal", () => {
    const GoalsPage = Route.options.component as ComponentType;
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <GoalsPage />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "New Goal" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.createGoal).not.toHaveBeenCalled();
  });
});
