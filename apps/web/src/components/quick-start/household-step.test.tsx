// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { HouseholdRole, HouseholdView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { HouseholdStep } from "./household-step";

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
}));

// Queries resolve from `mocks.queries` by function name; anything else stays unresolved.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data: mocks.queries[options.queryKey[1] as string],
  }),
}));
// No Convex client here: mutations and actions are never called by these tests.
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
  useConvexAction: () => vi.fn(),
}));
// Out of scope here: the other invite panels and the push offer.
vi.mock("@/components/household/household-member-invite", () => ({
  HouseholdMemberInvite: () => null,
}));
vi.mock("@/components/household/household-invite-link", () => ({
  HouseholdInviteLink: () => null,
}));
vi.mock("./push-prompt", () => ({ PushPrompt: () => null }));

const household = (viewerRole: HouseholdRole): HouseholdView => ({
  householdId: "h1",
  viewerRole,
  members: [
    {
      memberId: "m1",
      name: "Me",
      role: viewerRole,
      joinedAt: 0,
      isYou: true,
    },
  ],
  pendingInvites: [],
  joinRequests: [],
  defaultCopyPermission: "manage",
  copiesUsingDefault: 0,
});

const renderStep = (viewerRole: HouseholdRole) => {
  mocks.queries = {
    [getFunctionName(gateway.household.mine)]: household(viewerRole),
    [getFunctionName(gateway.household.myInvites)]: [],
    [getFunctionName(gateway.invitations.availability)]: true,
    [getFunctionName(gateway.invitations.listMine)]: [],
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <HouseholdStep onAlone={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("HouseholdStep email invite", () => {
  it("offers Invite by email to the household admin", () => {
    renderStep("admin");
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Invite by email" }),
    ).toBeTruthy();
  });

  it("doesn't show it to a member who isn't the admin", () => {
    renderStep("member");
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Invite by email" }),
    ).toBeNull();
  });
});
