// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { BlockMemberDialog, type BlockDialogMode } from "./block-member-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess:
    vi.fn<
      (
        message: string,
        options?: { action?: { label: string; onClick: () => void } },
      ) => void
    >(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const BLOCK = getFunctionName(gateway.social.blockMember);
const UNBLOCK = getFunctionName(gateway.social.unblockMember);
const MARA = "member_mara" as Id<"users">;

const renderDialog = (mode: BlockDialogMode) => {
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <BlockMemberDialog
        mode={mode}
        memberId={MARA}
        name="Mara"
        open
        onOpenChange={onOpenChange}
        onDone={onDone}
      />
    </IntlProvider>,
  );
  return { onOpenChange, onDone };
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("BlockMemberDialog (block)", () => {
  it("names the member, explains the consequences and focuses Cancel", () => {
    renderDialog("block");
    expect(
      screen.getByRole("alertdialog", { name: "Block Mara?" }),
    ).toBeTruthy();
    const body = screen.getByText(/won't be able to message you/).textContent;
    expect(body).toContain("Accepted trades can still be completed");
    expect(body).toContain("Shared circles or households aren't changed");
    expect(body).toContain("follows removed by the block aren't restored");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("confirm blocks, toasts with Undo, and Undo unblocks", async () => {
    const { onDone } = renderDialog("block");
    fireEvent.click(screen.getByRole("button", { name: "Block" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledWith(BLOCK, { memberId: MARA });
    const [message, options] = mocks.toastSuccess.mock.calls[0]!;
    expect(message).toBe("Blocked Mara");
    expect(options?.action?.label).toBe("Undo");

    options!.action!.onClick();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UNBLOCK, { memberId: MARA }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenLastCalledWith("Unblocked Mara"),
    );
  });

  it("shows the rate-limit copy for RateLimited and a generic error otherwise", async () => {
    mocks.mutation.mockRejectedValueOnce(
      new ConvexError({ code: "RateLimited", retryAfterMs: 1000 }),
    );
    const { onDone } = renderDialog("block");
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "You've made a lot of changes. Try again later.",
      ),
    );
    expect(onDone).not.toHaveBeenCalled();

    cleanup();
    mocks.mutation.mockRejectedValueOnce(new Error("network"));
    renderDialog("block");
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenLastCalledWith(
        "Couldn't block Mara. Please try again.",
      ),
    );
  });
});

describe("BlockMemberDialog (unblock)", () => {
  it("says follows aren't restored and confirm unblocks", async () => {
    const { onDone } = renderDialog("unblock");
    expect(
      screen.getByRole("alertdialog", { name: "Unblock Mara?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "They can message you again if you're connected. Follows removed by the block aren't restored.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledWith(UNBLOCK, { memberId: MARA });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Unblocked Mara");
  });
});
