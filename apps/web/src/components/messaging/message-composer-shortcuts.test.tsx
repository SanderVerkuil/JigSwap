// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { MessageComposer } from "./message-composer";

// Cmd/Ctrl+B/I/U in the thread composer; the edit rules themselves are in
// markup-shortcuts.test.ts.

const POST = getFunctionName(gateway.conversation.postMessage);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const renderComposer = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <MessageComposer
          threadId="thread_1"
          recipientName="Mara"
          theirsLabel={null}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue("message_1");
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MessageComposer formatting shortcuts", () => {
  it("wraps the selection on Ctrl+B and Enter still sends the marked-up text", async () => {
    renderComposer();
    const input = screen.getByRole("textbox", {
      name: "Message Mara",
    }) as HTMLTextAreaElement;
    expect(input.getAttribute("aria-keyshortcuts")).toContain("Control+B");

    fireEvent.change(input, { target: { value: "say hi" } });
    input.setSelectionRange(4, 6);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(input.value).toBe("say **hi**");
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 8]);

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        POST,
        expect.objectContaining({ body: "say **hi**" }),
      ),
    );
  });

  it("inserts italic and underline pairs at the caret", () => {
    renderComposer();
    const input = screen.getByRole("textbox", {
      name: "Message Mara",
    }) as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: "i", ctrlKey: true });
    expect(input.value).toBe("**");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "u", ctrlKey: true });
    expect(input.value).toBe("____");
  });
});
