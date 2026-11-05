// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
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

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess:
    vi.fn<
      (
        message: string,
        options?: { action?: { label: string; onClick: () => void } },
      ) => void
    >(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const FOLLOW = getFunctionName(gateway.social.follow);
const UNFOLLOW = getFunctionName(gateway.social.unfollow);
const CANCEL = getFunctionName(gateway.social.cancelFollowRequest);
const MARA = "member_mara" as Id<"users">;

type Relation = {
  following: boolean;
  followsYou: boolean;
  targetIsPrivate: boolean;
  pendingRequest: { requestId: string; requestedAt: number } | null;
};

const FOLLOWING_PUBLIC: Relation = {
  following: true,
  followsYou: false,
  targetIsPrivate: false,
  pendingRequest: null,
};

const renderButton = (
  relation: Relation,
  iconOnly = false,
  locale: "en" | "nl" = "en",
  memberName = "Mara",
) => {
  // The relation is seeded (Convex queries never go stale); the default queryFn serves the
  // same relation, so react-query has a queryFn without a Convex client behind it.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryFn: () => relation } },
  });
  queryClient.setQueryData(
    convexQuery(gateway.social.followRelation, { memberId: MARA }).queryKey,
    relation,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <FollowButton
          memberId={MARA}
          memberName={memberName}
          iconOnly={iconOnly}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

// Radix menus open on a primary-button pointerdown.
const openMenu = (name: string) =>
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
  });

const chooseUnfollow = async () =>
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Unfollow Mara" }),
  );

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("FollowButton (following)", () => {
  it("shows a Following state, not a direct Unfollow button", () => {
    renderButton(FOLLOWING_PUBLIC);
    const trigger = screen.getByRole("button", { name: "Following" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("button", { name: /Unfollow/ })).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("names the compact trigger after the member", () => {
    renderButton(FOLLOWING_PUBLIC, true);
    const trigger = screen.getByRole("button", { name: "Following Mara" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("unfollows a public member from the menu and offers Undo, which follows again", async () => {
    mocks.mutation.mockImplementation(async (name) =>
      name === FOLLOW ? { kind: "followed", id: "f2" } : null,
    );
    renderButton(FOLLOWING_PUBLIC, true);
    openMenu("Following Mara");
    await chooseUnfollow();

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UNFOLLOW, {
        followeeId: MARA,
      }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const [message, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(message).toBe("Unfollowed Mara");
    expect(options?.action?.label).toBe("Undo");

    // Undo still works after the tile is gone (the network list drops one-way tiles).
    cleanup();
    options!.action!.onClick();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(FOLLOW, {
        followeeId: MARA,
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenLastCalledWith(
        "You now follow Mara",
      ),
    );
  });

  it("says so when Undo can't follow again", async () => {
    renderButton(FOLLOWING_PUBLIC);
    openMenu("Following");
    await chooseUnfollow();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const [, options] = mocks.toastSuccess.mock.calls[0]!;

    mocks.mutation.mockRejectedValueOnce(new Error("rate limited"));
    options!.action!.onClick();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't follow Mara again. Please try again.",
      ),
    );
  });

  it("confirms first for a private member who doesn't follow back, and offers no Undo", async () => {
    renderButton({ ...FOLLOWING_PUBLIC, targetIsPrivate: true });
    openMenu("Following");
    await chooseUnfollow();

    const dialog = await screen.findByRole("alertdialog", {
      name: "Unfollow Mara?",
    });
    expect(dialog.textContent).toContain("send a new request");
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Unfollow" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UNFOLLOW, {
        followeeId: MARA,
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Unfollowed Mara",
        undefined,
      ),
    );
  });

  it("cancelling the confirm keeps the follow", async () => {
    renderButton({ ...FOLLOWING_PUBLIC, targetIsPrivate: true });
    openMenu("Following");
    await chooseUnfollow();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("skips the confirm for a private member who follows back (following again is instant)", async () => {
    renderButton({
      ...FOLLOWING_PUBLIC,
      targetIsPrivate: true,
      followsYou: true,
    });
    openMenu("Following");
    await chooseUnfollow();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const [, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(options?.action?.label).toBe("Undo");
  });

  it("reports a failed unfollow", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("network"));
    renderButton(FOLLOWING_PUBLIC);
    openMenu("Following");
    await chooseUnfollow();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not update follow status",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("FollowButton refusals", () => {
  const NOT_FOLLOWING: Relation = { ...FOLLOWING_PUBLIC, following: false };
  const rateLimited = () =>
    new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 });

  it("says so when following is rate limited", async () => {
    mocks.mutation.mockRejectedValue(rateLimited());
    renderButton(NOT_FOLLOWING);
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've followed and unfollowed a lot. Try again later.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(FOLLOW, { followeeId: MARA });
  });

  it("says so when unfollowing is rate limited, in Dutch too", async () => {
    mocks.mutation.mockRejectedValue(rateLimited());
    renderButton(FOLLOWING_PUBLIC, false, "nl");
    openMenu("Volgend");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Mara ontvolgen" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Je hebt vaak gevolgd en ontvolgd. Probeer het later opnieuw.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(UNFOLLOW, {
      followeeId: MARA,
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("says so when Undo is rate limited, not that it merely failed", async () => {
    renderButton(FOLLOWING_PUBLIC);
    openMenu("Following");
    await chooseUnfollow();
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const [, options] = mocks.toastSuccess.mock.calls[0]!;

    mocks.mutation.mockRejectedValueOnce(rateLimited());
    options!.action!.onClick();
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've followed and unfollowed a lot. Try again later.",
      ),
    );
  });

  it("says so when cancelling a request is rate limited", async () => {
    mocks.mutation.mockRejectedValue(rateLimited());
    renderButton({
      ...NOT_FOLLOWING,
      targetIsPrivate: true,
      pendingRequest: { requestId: "req_1", requestedAt: Date.now() },
    });
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
    renderButton(NOT_FOLLOWING);
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not update follow status",
      ),
    );
  });
});

// The Button already spaces its icons (gap-2). An icon margin on top doubled the gap and
// widened the labelled buttons enough to push the 390px profile hero's overflow menu onto
// a row of its own (UX-118 / UX-32 review follow-up).
describe("FollowButton labelled icon spacing", () => {
  const ICON_MARGIN = /^-?m[lrxse]-/;

  it.each<[string, Relation]>([
    ["Follow", { ...FOLLOWING_PUBLIC, following: false }],
    ["Following", FOLLOWING_PUBLIC],
    [
      "Requested",
      {
        ...FOLLOWING_PUBLIC,
        following: false,
        targetIsPrivate: true,
        pendingRequest: { requestId: "request_1", requestedAt: Date.now() },
      },
    ],
  ])("%s adds no margin of its own to its icons", (name, relation) => {
    renderButton(relation);
    const icons = [
      ...screen.getByRole("button", { name }).querySelectorAll("svg"),
    ];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect([...icon.classList].filter((c) => ICON_MARGIN.test(c))).toEqual(
        [],
      );
    }
  });
});

// The follow toast says whom you now follow; Dutch never stops at "Je volgt nu" (UX-65).
describe("FollowButton toast", () => {
  const NOT_FOLLOWING: Relation = { ...FOLLOWING_PUBLIC, following: false };

  beforeEach(() => {
    mocks.mutation.mockResolvedValue({ kind: "followed", id: "f1" });
  });

  it.each([
    ["en", "Follow", "You now follow Mara"],
    ["nl", "Volgen", "Je volgt Mara nu"],
  ] as const)("names the member in %s", async (locale, label, toast) => {
    renderButton(NOT_FOLLOWING, false, locale);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(toast));
  });

  it.each([
    ["en", "Follow", "Following"],
    ["nl", "Volgen", "Je volgt dit lid nu"],
  ] as const)(
    "still reads as a whole sentence without a name in %s",
    async (locale, label, toast) => {
      renderButton(NOT_FOLLOWING, false, locale, "");
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() =>
        expect(mocks.toastSuccess).toHaveBeenCalledWith(toast),
      );
    },
  );
});
