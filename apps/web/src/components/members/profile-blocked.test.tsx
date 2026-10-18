// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ProfileBody, type PublicProfileView } from "./profile-body";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  invalidate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const UNBLOCK = getFunctionName(gateway.social.unblockMember);

// The stub getPublicProfile returns for a member the viewer blocked.
const blockedProfile = {
  locked: true,
  blockedByMe: true,
  hero: {
    memberId: "member_hans",
    displayName: "Hans",
    username: "hans",
    memberSince: Date.UTC(2024, 0, 1),
    visibility: "private",
    followerCount: 0,
    followingCount: 0,
    reviewCount: 0,
    rating: 0,
  },
} as unknown as PublicProfileView;

afterEach(cleanup);

describe("ProfileBody for a member the viewer blocked", () => {
  it("replaces the locked card and the hero actions with the blocked panel", async () => {
    mocks.mutation.mockResolvedValue(null);
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ProfileBody profile={blockedProfile} viewer="member" />
      </IntlProvider>,
    );

    expect(screen.getByText("You blocked Hans.")).toBeTruthy();
    expect(screen.queryByText(/This shelf is private/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Follow/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Message/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /More actions/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    expect(
      screen.getByRole("alertdialog", { name: "Unblock Hans?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Unblock" }).at(-1)!);
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UNBLOCK, {
        memberId: "member_hans",
      }),
    );
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
  });
});
