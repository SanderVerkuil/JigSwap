// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
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
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CircleInvitePicker } from "./circle-invite-picker";
import { InviteToCircleDialog } from "./invite-to-circle-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

const INVITE = getFunctionName(gateway.sharing.inviteToCircle);

const renderWith = (node: ReactNode) => {
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
  queryClient.setQueryData(
    convexQuery(gateway.sharing.invitableMembers, { circleId: "c1" }).queryKey,
    [{ member: { _id: "u_anna", name: "Anna" } }],
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        {node}
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

// "Private groups to swap within": a default invitee who can't request or share misses the point.
describe("who a circle invite is for", () => {
  it("defaults the manage dialog's picker to Can exchange, under a visible label", async () => {
    renderWith(<CircleInvitePicker circleId="c1" />);
    const select = screen.getByLabelText(en.circles.invite.permissionLabel);
    expect(select.textContent).toContain(en.circles.permissions.Exchange);
    // A real label on the page, not only an accessible name.
    expect(screen.getByText(en.circles.invite.permissionLabel).tagName).toBe(
      "LABEL",
    );

    fireEvent.click(
      screen.getByRole("button", { name: en.circles.invite.send }),
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(INVITE, {
        circleId: "c1",
        inviteeId: "u_anna",
        permission: "Exchange",
      }),
    );
  });

  it("defaults the profile's invite dialog to Can exchange too", async () => {
    renderWith(
      <InviteToCircleDialog
        memberId={"u_anna" as Id<"users">}
        name="Anna"
        circles={[{ circleId: "c1", name: "Family" }]}
        open
        onOpenChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(en.circles.invite.permissionLabel);
    expect(select.textContent).toContain(en.circles.permissions.Exchange);

    fireEvent.click(
      screen.getByRole("button", { name: en.circles.invite.send }),
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(INVITE, {
        circleId: "c1",
        inviteeId: "u_anna",
        permission: "Exchange",
      }),
    );
  });
});
