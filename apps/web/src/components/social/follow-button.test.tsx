// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
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
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { FollowButton } from "./follow-button";

const FOLLOW = getFunctionName(gateway.social.follow);
const UNFOLLOW = getFunctionName(gateway.social.unfollow);
const CANCEL = getFunctionName(gateway.social.cancelFollowRequest);
const RELATION = getFunctionName(gateway.social.followRelation);
const MARA = "member_mara" as Id<"users">;

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  queries: {} as Record<string, unknown>,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
// Queries resolve from `mocks.queries` by function name; anything else stays unresolved.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data: mocks.queries[options.queryKey[1] as string],
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const relation = (overrides: Record<string, unknown> = {}) => ({
  following: false,
  followsYou: false,
  targetIsPrivate: false,
  pendingRequest: null,
  ...overrides,
});

const renderButton = (locale: "en" | "nl" = "en") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <FollowButton memberId={MARA} />
      </IntlProvider>
    </QueryClientProvider>,
  );

const rateLimited = () =>
  new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 });

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue({ kind: "followed", id: "f1" });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.queries = { [RELATION]: relation() };
});
afterEach(cleanup);

describe("FollowButton refusals", () => {
  it("says so when following is rate limited", async () => {
    mocks.mutation.mockRejectedValue(rateLimited());
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've followed and unfollowed a lot. Try again later.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(FOLLOW, { followeeId: MARA });
  });

  it("says so when unfollowing is rate limited, in Dutch too", async () => {
    mocks.queries = { [RELATION]: relation({ following: true }) };
    mocks.mutation.mockRejectedValue(rateLimited());
    renderButton("nl");
    fireEvent.click(screen.getByRole("button", { name: "Ontvolgen" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Je hebt vaak gevolgd en ontvolgd. Probeer het later opnieuw.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(UNFOLLOW, {
      followeeId: MARA,
    });
  });

  it("says so when cancelling a request is rate limited", async () => {
    mocks.queries = {
      [RELATION]: relation({
        targetIsPrivate: true,
        pendingRequest: { requestId: "req_1", requestedAt: Date.now() },
      }),
    };
    mocks.mutation.mockRejectedValue(rateLimited());
    renderButton();
    fireEvent.keyDown(screen.getByRole("button", { name: /Requested/ }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Cancel request" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've followed and unfollowed a lot. Try again later.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(CANCEL, {
      requestId: "req_1",
    });
  });

  it("keeps the generic error for any other failure", async () => {
    mocks.mutation.mockRejectedValue(new ConvexError({ code: "Blocked" }));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not update follow status",
      ),
    );
  });
});
