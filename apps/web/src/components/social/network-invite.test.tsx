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
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { NetworkInvite } from "./network-invite";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const MY_INVITE_LINK = getFunctionName(gateway.social.myInviteLink);

const renderInvite = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <NetworkInvite memberId="m1" />
      </IntlProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue({ token: "tok" });
});
afterEach(cleanup);

describe("NetworkInvite", () => {
  it("offers the invite link through the share buttons", async () => {
    renderInvite();
    const whatsApp = await screen.findByRole("link", { name: "WhatsApp" });
    expect(decodeURIComponent(whatsApp.getAttribute("href")!)).toContain(
      "/members/m1?invite=tok",
    );
  });

  it("says so when the link can't be fetched, and asks again on Try again", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("offline"));
    renderInvite();
    expect((await screen.findByRole("alert")).textContent).toContain(
      en.invite.linkError,
    );
    fireEvent.click(screen.getByRole("button", { name: en.invite.retry }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "WhatsApp" })).toBeTruthy(),
    );
    expect(mocks.mutation).toHaveBeenLastCalledWith(MY_INVITE_LINK, {});
  });
});
