// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PrivacySection } from "./privacy-section";

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

const SET_VISIBILITY = getFunctionName(gateway.social.setProfileVisibility);
const RESET_LINK = getFunctionName(gateway.social.resetInviteLink);

const renderSection = (visibility: "public" | "private" | null) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  // null = the member never saved a Social profile: the public default applies.
  queryClient.setQueryData(
    convexQuery(gateway.social.profile, {}).queryKey,
    visibility === null
      ? null
      : {
          _id: "profile_henk",
          _creationTime: 0,
          memberId: "member_henk",
          visibility,
          updatedAt: 0,
        },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PrivacySection />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const radio = (name: string) => screen.getByRole("radio", { name });

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("PrivacySection", () => {
  it("is the #privacy anchor and clears the sticky head when scrolled to", () => {
    renderSection("public");
    const section = screen
      .getByRole("heading", { name: "Privacy" })
      .closest("section");
    expect(section?.id).toBe("privacy");
    expect(section?.className).toContain("scroll-mt-");
  });

  it("reflects a stored public profile with its status line", () => {
    renderSection("public");
    expect(
      screen.getByRole("radiogroup", { name: "Who can see your profile?" }),
    ).toBeTruthy();
    expect(radio("Everyone").getAttribute("aria-checked")).toBe("true");
    expect(radio("Only people you approve").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(
      screen.getByText(
        "Signed-in members can find you in Find people and Search, and see your full profile when they open your link. Members you've blocked can't.",
      ),
    ).toBeTruthy();
  });

  it("treats a member without a saved profile as public", () => {
    renderSection(null);
    expect(radio("Everyone").getAttribute("aria-checked")).toBe("true");
  });

  it("reflects a stored private profile with its status line", () => {
    renderSection("private");
    expect(radio("Only people you approve").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      screen.getByText(
        "Only members you follow each other with can find you in Find people and Search, and see your full profile. Everyone else sees a locked profile, and elsewhere sees you as Anonymous user unless you share a circle or a trade.",
      ),
    ).toBeTruthy();
  });

  it("saves a new choice at once and offers an Undo that restores the old one", async () => {
    renderSection("public");
    fireEvent.click(radio("Only people you approve"));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    expect(mocks.mutation).toHaveBeenCalledWith(SET_VISIBILITY, {
      visibility: "private",
    });
    const [message, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(message).toBe("Your profile is now private");
    expect(options?.action?.label).toBe("Undo");

    options!.action!.onClick();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenLastCalledWith(SET_VISIBILITY, {
        visibility: "public",
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenLastCalledWith(
        "Your profile is now public",
      ),
    );
  });

  it("shows the chosen value while the save is in flight", async () => {
    mocks.mutation.mockReturnValue(new Promise<never>(() => {}));
    renderSection("public");
    fireEvent.click(radio("Only people you approve"));
    await waitFor(() =>
      expect(
        radio("Only people you approve").getAttribute("aria-checked"),
      ).toBe("true"),
    );
    expect(
      screen.getByText(
        "Only members you follow each other with can find you in Find people and Search, and see your full profile. Everyone else sees a locked profile, and elsewhere sees you as Anonymous user unless you share a circle or a trade.",
      ),
    ).toBeTruthy();
  });

  it("falls back to the stored value and says so when the save fails", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("network"));
    renderSection("public");
    fireEvent.click(radio("Only people you approve"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't change who can see your profile. Please try again.",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(radio("Everyone").getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("says it has changed a lot lately when the server refuses another change", async () => {
    mocks.mutation.mockRejectedValueOnce(
      new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
    );
    renderSection("public");
    fireEvent.click(radio("Only people you approve"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've changed this a lot lately. Try again later.",
      ),
    );
    await waitFor(() =>
      expect(radio("Everyone").getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("does nothing when the current choice is picked again", () => {
    renderSection("private");
    fireEvent.click(radio("Only people you approve"));
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("resets the invite link only after a confirm", async () => {
    renderSection("public");
    fireEvent.click(screen.getByRole("button", { name: "Reset invite link" }));
    expect(mocks.mutation).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog", {
      name: "Reset your invite link?",
    });
    expect(dialog.textContent).toContain(
      "Links and QR codes you've already shared will stop working.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(RESET_LINK, {}),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Your invite link was reset",
      ),
    );
  });
});

describe("PrivacySection layout", () => {
  // Side by side only when the section itself is wide enough: at 820px, with the sidebar
  // open, a viewport (sm) switch squeezed the text beside the pills into ~160px.
  it("puts each setting beside its control by the section's width, not the viewport's", () => {
    renderSection("public");
    const section = screen
      .getByRole("heading", { name: "Privacy" })
      .closest("section")!;
    expect(section.classList).toContain("@container/privacy");
    const rows = [
      screen.getByRole("radiogroup", { name: "Who can see your profile?" }),
      screen.getByRole("button", { name: "Reset invite link" }),
    ].map((control) => {
      let row = control.parentElement!;
      while (!row.parentElement!.classList.contains("divide-y")) {
        row = row.parentElement!;
      }
      return [...row.classList];
    });
    expect(rows).toHaveLength(2);
    for (const classes of rows) {
      expect(classes).toEqual(
        expect.arrayContaining(["flex-col", "@2xl/privacy:flex-row"]),
      );
      expect(
        classes.filter((name) => /^(sm|md|lg|xl):flex-row$/.test(name)),
      ).toEqual([]);
    }
  });
});
