// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";

const mocks = vi.hoisted(() => ({
  actions: vi.fn(),
  params: { threadId: "thread_1" } as { threadId?: string },
}));

vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: mocks.actions,
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: null }),
}));
vi.mock("@/components/messaging/inbox-window", () => ({
  InboxWindowProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/components/messaging/new-conversation-menu", () => ({
  NewConversationMenu: () => null,
}));
vi.mock("@/lib/member-display-name", () => ({
  useMemberDisplayName: () => (name: string) => name,
}));
vi.mock("@/gateway", () => ({
  gateway: { presence: {}, conversation: { getMyInbox: {} } },
}));
vi.mock("@convex-dev/presence/react", () => ({ default: () => undefined }));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Outlet: () => null,
  useNavigate: () => vi.fn(),
  useParams: () => mocks.params,
}));

const { Route } = await import("./route");
const MessagesLayout = (
  Route as unknown as { options: { component: React.FC } }
).options.component;

const renderLayout = () =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <MessagesLayout />
    </IntlProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.actions.mockClear();
  mocks.params = { threadId: "thread_1" };
});

describe("Messages layout", () => {
  // A dead thread's not-found clears the page head when it unmounts. Keying the
  // "New" action on the thread makes the layout publish it again afterwards.
  it("republishes New whenever the open thread changes", () => {
    const view = renderLayout();
    expect(mocks.actions).toHaveBeenLastCalledWith(expect.any(Function), [
      "thread_1",
    ]);

    mocks.params = {};
    view.rerender(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <MessagesLayout />
      </IntlProvider>,
    );
    expect(mocks.actions).toHaveBeenLastCalledWith(expect.any(Function), [
      undefined,
    ]);
  });
});
