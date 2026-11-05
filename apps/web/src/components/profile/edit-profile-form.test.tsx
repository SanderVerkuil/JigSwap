// @vitest-environment happy-dom
import { gateway } from "@/gateway";
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
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { EditProfileForm } from "./edit-profile-form";
import type { Member } from "./member-view";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ isLoaded: true, user: { username: null } }),
  useReverification: <T,>(fn: T) => fn,
  isReverificationCancelledError: () => false,
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EDIT_PROFILE = getFunctionName(gateway.social.editProfile);
const UPDATE_PROFILE = getFunctionName(gateway.identity.updateProfile);
const SET_VISIBILITY = getFunctionName(gateway.social.setProfileVisibility);

// A member who never picked a username or slug: the link preview falls back to
// the long Convex id, the case that widened the form past a phone screen.
const member: Member = {
  _id: "kd7945krncsg0nr1chmgbgnw2x7m0dca",
  handle: "kd7945krncsg0nr1chmgbgnw2x7m0dca",
  _creationTime: 0,
  clerkId: "user_henk",
  name: "Henk Pieterszoon",
  isActive: true,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const renderForm = (
  profile: { displayName?: string; bio?: string } = {},
  accountFields: Partial<Member> = {},
) => {
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
    ...profile,
  });
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <EditProfileForm
          member={{ ...member, ...accountFields }}
          onDone={onDone}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { onDone };
};

const editProfileCalls = () =>
  mocks.mutation.mock.calls.filter(([name]) => name === EDIT_PROFILE);

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
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
});

// One save model: every field in this form waits for Save, and Cancel drops
// them all. Visibility saves instantly, so it lives in the Privacy section.
describe("EditProfileForm saving", () => {
  it("has no instantly-saving visibility control", () => {
    renderForm();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Private profile")).toBeNull();
  });

  it("edits the display name inline, seeded from the saved one", () => {
    renderForm({ displayName: "Puzzelhenk" });
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("Puzzelhenk");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("caps the display name at the server's 50 characters", () => {
    renderForm();
    expect(
      screen.getByLabelText("Display name").getAttribute("maxlength"),
    ).toBe("50");
  });

  it("shows the account name as the placeholder when no display name is set", () => {
    renderForm();
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Henk Pieterszoon");
  });

  it("sends a changed display name and the bio in one editProfile call", async () => {
    const { onDone } = renderForm({ displayName: "Henk", bio: "Old bio" });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  Puzzelhenk " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(editProfileCalls()).toEqual([
      [EDIT_PROFILE, { displayName: "Puzzelhenk", bio: "Old bio" }],
    ]);
    expect(mocks.mutation).not.toHaveBeenCalledWith(
      SET_VISIBILITY,
      expect.anything(),
    );
  });

  it("keeps the display name when only the bio changed", async () => {
    const { onDone } = renderForm({ displayName: "Henk", bio: "Old bio" });
    fireEvent.change(screen.getByLabelText("Bio"), {
      target: { value: "New bio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(editProfileCalls()).toHaveLength(1);
    const [, args] = editProfileCalls()[0]!;
    expect(args).toEqual({ bio: "New bio" });
    expect(args).not.toHaveProperty("displayName", expect.anything());
  });

  it("skips editProfile when neither the name nor the bio changed", async () => {
    const { onDone } = renderForm({ displayName: "Henk", bio: "Old bio" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(editProfileCalls()).toHaveLength(0);
  });

  // undefined means "leave it as it is" to updateProfile, so an emptied field must send "".
  it("clears a location the member emptied", async () => {
    const { onDone } = renderForm({}, { location: "Utrecht" });
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledWith(UPDATE_PROFILE, {
      location: "",
    });
  });

  it("sends a changed location trimmed", async () => {
    const { onDone } = renderForm({}, { location: "Utrecht" });
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: "  Obdam " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledWith(UPDATE_PROFILE, {
      location: "Obdam",
    });
  });

  it("flags an emptied display name inline and saves nothing", () => {
    const { onDone } = renderForm({ displayName: "Henk" });
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "   " } });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Display name cannot be empty")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(save);
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
