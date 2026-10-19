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

// The composer's emoji button. The picker itself (frimousse, which fetches its
// data from a CDN) is replaced by a stub: this tests the lazy load, the caret
// insert and the focus hand-back.

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

const picker = vi.hoisted(() => ({ loads: 0 }));
vi.mock("./message-emoji-picker", () => {
  picker.loads++;
  return {
    default: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
      <button type="button" onClick={() => onSelect("🧩")}>
        stub puzzle emoji
      </button>
    ),
  };
});

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
});
afterEach(cleanup);

describe("MessageComposer emoji", () => {
  it("loads the picker on first open and inserts the emoji at the caret", async () => {
    renderComposer();
    const input = screen.getByRole("textbox", {
      name: "Message Mara",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "ab cd" } });
    input.setSelectionRange(2, 2);
    expect(picker.loads).toBe(0);

    const button = screen.getByRole("button", { name: "Add emoji" });
    // Between the textarea and the paperclip/Send, in DOM order.
    expect(
      input.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(button);
    fireEvent.click(await screen.findByText("stub puzzle emoji"));

    expect(picker.loads).toBe(1);
    expect(input.value).toBe("ab🧩 cd");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(4);
    expect(screen.queryByText("stub puzzle emoji")).toBeNull();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        POST,
        expect.objectContaining({ body: "ab🧩 cd" }),
      ),
    );
  });
});
