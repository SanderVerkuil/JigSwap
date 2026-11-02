// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { HouseholdRole, HouseholdView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
// The other invite panels render as markers (their own tests cover them); no push offer.
vi.mock("@/components/household/household-member-invite", () => ({
  HouseholdMemberInvite: () => <div data-testid="member-invite" />,
}));
vi.mock("@/components/household/household-invite-link", () => ({
  HouseholdInviteLink: ({ showRevoke }: { showRevoke?: boolean }) => (
    <div data-testid="invite-link" data-show-revoke={String(showRevoke)} />
  ),
}));
vi.mock("./push-prompt", () => ({ PushPrompt: () => null }));

const household = (
  viewerRole: HouseholdRole,
  others: number,
): HouseholdView => ({
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
    ...Array.from({ length: others }, (_, i) => ({
      memberId: `o${i}`,
      name: `Other ${i}`,
      role: "member" as const,
      joinedAt: 0,
      isYou: false,
    })),
  ],
  pendingInvites: [],
  joinRequests: [],
  defaultCopyPermission: "manage",
});

const renderStep = (viewerRole: HouseholdRole, others = 0) => {
  mocks.queries = {
    [getFunctionName(gateway.household.mine)]: household(viewerRole, others),
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

const moreInvites = () =>
  screen.getByRole("button", { name: "Invite by name or email" });

describe("HouseholdStep invite panel (admin)", () => {
  it("leads with the share link, without Revoke open links", () => {
    renderStep("admin");
    const link = screen.getByTestId("invite-link");
    expect(link.getAttribute("data-show-revoke")).toBe("false");
    expect(
      link.compareDocumentPosition(moreInvites()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("folds the name search and the email invite behind one disclosure", () => {
    renderStep("admin");
    expect(moreInvites().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("member-invite")).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    fireEvent.click(moreInvites());
    expect(moreInvites().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("member-invite")).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });
});

describe("HouseholdStep members", () => {
  it("says just you so far in a household of one", () => {
    renderStep("admin");
    expect(screen.getByText("Just you so far")).toBeTruthy();
  });

  it("doesn't once someone else joined", () => {
    renderStep("admin", 1);
    expect(screen.queryByText("Just you so far")).toBeNull();
  });
});

describe("HouseholdStep email invite", () => {
  it("offers Invite by email to the household admin", () => {
    renderStep("admin");
    fireEvent.click(moreInvites());
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Invite by email" }),
    ).toBeTruthy();
  });

  it("doesn't show it to a member who isn't the admin", () => {
    renderStep("member", 1);
    expect(
      screen.queryByRole("button", { name: "Invite by name or email" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Invite by email" }),
    ).toBeNull();
  });
});
