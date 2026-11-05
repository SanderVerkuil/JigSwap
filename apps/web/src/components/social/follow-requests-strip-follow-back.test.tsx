// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { FollowRequestsStrip } from "./follow-requests-strip";

const APPROVE = getFunctionName(gateway.social.approveFollowRequest);
const FOLLOW = getFunctionName(gateway.social.follow);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastWarning: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
// The strip's only query: one request from Mara, who the viewer doesn't follow yet.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({
    data: [
      {
        requestId: "fr_1",
        alreadyFollowing: false,
        requester: {
          memberId: "member_mara",
          displayName: "Mara",
          username: "mara",
        },
      },
    ],
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: mocks.toastError,
  },
}));

const renderStrip = (locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <FollowRequestsStrip />
      </IntlProvider>
    </QueryClientProvider>,
  );

// The approve commits; the follow back answers with `followBackFailure`.
const approveThenFail = (followBackFailure: Error) =>
  mocks.mutation.mockImplementation((name) =>
    name === APPROVE
      ? Promise.resolve({
          requesterId: "member_mara",
          alreadyFollowsBack: false,
        })
      : Promise.reject(followBackFailure),
  );

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastWarning.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("FollowRequestsStrip follow back", () => {
  it("says the approval stuck and the follow back has to wait when it is rate limited", async () => {
    approveThenFail(new ConvexError({ code: "RateLimited" }));
    renderStrip();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve & follow back" }),
    );

    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith(
        "Approved — but you've followed and unfollowed a lot, so following them back has to wait. Try again later.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(FOLLOW, {
      followeeId: "member_mara",
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("says so in Dutch too", async () => {
    approveThenFail(new ConvexError({ code: "RateLimited" }));
    renderStrip("nl");
    fireEvent.click(
      screen.getByRole("button", { name: "Goedkeuren & terugvolgen" }),
    );

    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith(
        "Goedgekeurd — maar je hebt vaak gevolgd en ontvolgd, dus terugvolgen moet even wachten. Probeer het later opnieuw.",
      ),
    );
  });

  it("keeps the recovery hint for any other follow back failure", async () => {
    approveThenFail(new Error("offline"));
    renderStrip();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve & follow back" }),
    );

    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith(
        "Approved — but following them back failed, use the Follow button on their tile",
      ),
    );
  });
});
