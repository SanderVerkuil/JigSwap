// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { INVITE_KEY } from "./invite-landing";
import { InviteRedeemer } from "./invite-redeemer";

const mocks = vi.hoisted(() => ({
  qrDialogLoaded: 0,
  redeem: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

// The QR dialog (and qrcode.react behind it): loaded only for the loop-closure prompt.
vi.mock("@/components/social/qr-dialog", () => {
  mocks.qrDialogLoaded++;
  return {
    QrDialogAutoOpen: ({ title }: { title: string }) => (
      <div role="dialog">{title}</div>
    ),
  };
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const { gateway } = await import("@/gateway");
  const { getFunctionName } = await import("convex/server");
  const quickStart = getFunctionName(gateway.onboarding.quickStart);
  return {
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    // The member, and a quick start state that isn't covering invites.
    useQuery: (options: { queryKey: unknown[] }) => ({
      data: options.queryKey.includes(quickStart)
        ? { eligible: false, cardVisible: false }
        : {
            _id: "member_me",
            name: "Me",
            username: "me",
            avatar: null,
            createdAt: 0,
          },
    }),
  };
});

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => mocks.redeem,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
}));

const renderRedeemer = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <InviteRedeemer />
      </IntlProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  mocks.redeem.mockReset().mockResolvedValue({ redeemed: true });
});
afterEach(cleanup);

// In order: the first case must run before anything has loaded the QR dialog module.
describe("InviteRedeemer", () => {
  it("doesn't load the QR dialog when there is no invite to close the loop on", async () => {
    // A long-standing member: no fallback nudge either.
    localStorage.setItem("jigswap.inviteFallbackShown", "1");
    const { container } = renderRedeemer();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.textContent).toBe("");
    expect(mocks.redeem).not.toHaveBeenCalled();
    expect(mocks.qrDialogLoaded).toBe(0);
  });

  it("loads and shows the member's own QR after redeeming an invite", async () => {
    localStorage.setItem(INVITE_KEY, "token-1");
    renderRedeemer();
    expect(await screen.findByRole("dialog")).toHaveProperty(
      "textContent",
      "Anyone else here?",
    );
    expect(mocks.redeem.mock.calls[0]?.[0]).toEqual({ token: "token-1" });
    expect(mocks.qrDialogLoaded).toBe(1);
  });
});
