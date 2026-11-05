// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route as ProfileRoute } from "./profile";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { _id: "m1", name: "Mara" } }),
}));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@/gateway", () => ({ gateway: { identity: {} } }));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
}));
// The page's sections are out of scope: this pins when the form opens and what it is told.
vi.mock("@/components/profile/identity-header", () => ({
  IdentityHeader: ({
    isEditing,
    onToggleEdit,
  }: {
    isEditing: boolean;
    onToggleEdit: () => void;
  }) => (
    <button type="button" onClick={onToggleEdit}>
      {isEditing ? "cancel" : "edit"}
    </button>
  ),
}));
vi.mock("@/components/profile/edit-profile-form", () => ({
  EditProfileForm: ({ focusCustomLink }: { focusCustomLink?: boolean }) => (
    <p>{focusCustomLink ? "form on the link field" : "form"}</p>
  ),
}));
vi.mock("@/components/profile/privacy-section", () => ({
  PrivacySection: () => null,
}));
vi.mock("@/components/profile/shelf-section", () => ({
  ProfileShelfSection: () => null,
}));
vi.mock("@/components/profile/stats-section", () => ({
  ProfileStatsSection: () => null,
}));
vi.mock("@/components/reputation/reputation-section", () => ({
  ReputationSection: () => null,
}));
vi.mock("@/components/social/qr-dialog", () => ({ QrDialog: () => null }));

function makeRouter(url: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Outlet />
      </IntlProvider>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    id: "_dashboard",
    component: Outlet,
  });
  // Attach the real file route the way routeTree.gen does, so its useSearch/useNavigate resolve.
  const profile = ProfileRoute.update({
    id: "/profile",
    path: "/profile",
    getParentRoute: () => dashboard,
  } as never);
  return createRouter({
    routeTree: rootRoute.addChildren([dashboard.addChildren([profile])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
}

describe("/profile ?edit", () => {
  let container: HTMLDivElement;
  let root: Root;

  const open = async (url: string) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const router = makeRouter(url);
    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });
    return router;
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the form closed on a bare /profile", async () => {
    await open("/profile");
    expect(document.body.textContent).not.toContain("form");
  });

  it("opens the form for ?edit=profile, without moving focus", async () => {
    await open("/profile?edit=profile");
    await vi.waitFor(() => expect(document.body.textContent).toContain("form"));
    expect(document.body.textContent).not.toContain("link field");
  });

  it("opens the form on the custom-link field for ?edit=link", async () => {
    await open("/profile?edit=link");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("form on the link field"),
    );
  });

  it("drops the flag when the form closes, so Back and reload don't reopen it", async () => {
    const router = await open("/profile?edit=link");
    await vi.waitFor(() => expect(document.body.textContent).toContain("form"));
    await act(async () => {
      container.querySelector("button")!.click();
    });
    await vi.waitFor(() =>
      expect(router.state.resolvedLocation?.search).toEqual({}),
    );
    expect(document.body.textContent).not.toContain("form");
  });
});
