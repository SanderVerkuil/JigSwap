// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { EditProfileForm } from "./edit-profile-form";
import type { Member } from "./member-view";

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ isLoaded: true, user: { username: null } }),
  useReverification: <T,>(fn: T) => fn,
  isReverificationCancelledError: () => false,
}));

// The display-name dialog has its own reads; only its trigger matters here.
vi.mock("@/components/social/profile-edit-dialog", () => ({
  ProfileEditDialog: () => <button type="button">Edit</button>,
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => () => Promise.resolve(null),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// A member who never picked a username or slug: the link preview falls back to
// the long Convex id, the case that widened the form past a phone screen.
const member: Member = {
  _id: "kd7945krncsg0nr1chmgbgnw2x7m0dca",
  _creationTime: 0,
  clerkId: "user_henk",
  name: "Henk Pieterszoon",
  isActive: true,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const renderForm = () => {
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
  queryClient.setQueryData(convexQuery(gateway.social.profile, {}).queryKey, {
    _id: "profile_henk",
    _creationTime: 0,
    memberId: member._id,
    visibility: "public",
    updatedAt: 0,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <EditProfileForm member={member} onDone={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

// happy-dom has no layout engine, so these pin the class contract that keeps
// the form inside a 390px screen; the geometry itself was checked in a browser.
describe("EditProfileForm on a phone", () => {
  it("is one explicit column below sm, so no field can size the track", () => {
    renderForm();
    const grid = screen.getByLabelText("Username").closest(".grid");
    expect(grid?.classList).toContain("grid-cols-1");
    expect(grid?.classList).toContain("sm:grid-cols-2");
  });

  it("wraps a long profile-link preview instead of keeping it on one line", () => {
    renderForm();
    const url = screen.getByText(`/members/${member._id}`, { exact: false });
    const preview = url.parentElement;
    expect(preview?.textContent).toContain("Your profile link:");
    expect(preview?.classList).not.toContain("truncate");
    expect(url.classList).toContain("break-all");
  });

  it("lets the text beside the display-name and visibility controls shrink", () => {
    renderForm();
    const visibilityText = screen.getByText("Private profile").parentElement;
    const displayNameText = screen.getByText("Display name").parentElement;
    expect(visibilityText?.classList).toContain("min-w-0");
    expect(displayNameText?.classList).toContain("min-w-0");
  });
});
