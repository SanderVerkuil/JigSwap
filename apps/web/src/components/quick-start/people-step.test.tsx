// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PeopleStep } from "./people-step";

const mocks = vi.hoisted(() => ({
  member: undefined as { _id: string; username?: string } | undefined,
  fetchLink: vi.fn(),
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: mocks.member, isMemberLoading: false }),
}));
// No suggestions: the follow lists stay unresolved. The invite link resolves to a fixed token.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({ mutate: mocks.fetchLink, data: { token: "tok" } }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@/components/social/invite-share-actions", () => ({
  InviteShareActions: ({ url }: { url: string | null }) => (
    <a data-testid="invite-share" href={url ?? undefined} />
  ),
}));
// Out of scope here: the offers strip, search, email invite and push offer.
vi.mock("@/components/social/connection-offers", () => ({
  ConnectionOffersStrip: () => null,
}));
vi.mock("@/components/social/find-people", () => ({ FindPeople: () => null }));
vi.mock("@/components/social/email-invite", () => ({
  EmailInvite: () => null,
}));
vi.mock("./push-prompt", () => ({ PushPrompt: () => null }));

const renderStep = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PeopleStep status="todo" />
    </IntlProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.fetchLink.mockClear();
});

describe("PeopleStep invite link (UX-85)", () => {
  it("offers the invite link to a member without a username", () => {
    mocks.member = { _id: "m1" };
    renderStep();
    // The link is the stable member-id URL, so it never needs a username.
    expect(screen.getByTestId("invite-share").getAttribute("href")).toMatch(
      /\/members\/m1\?invite=tok$/,
    );
    expect(mocks.fetchLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Set a username first")).toBeNull();
    expect(screen.queryByText("Open account settings")).toBeNull();
  });

  it("offers the same link to a member with a username", () => {
    mocks.member = { _id: "m2", username: "ann" };
    renderStep();
    expect(screen.getByTestId("invite-share").getAttribute("href")).toMatch(
      /\/members\/m2\?invite=tok$/,
    );
  });
});
