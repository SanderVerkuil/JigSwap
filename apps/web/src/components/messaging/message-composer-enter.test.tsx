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

// What Enter does in the thread composer; the full key table is in
// enter-to-send.test.ts.

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

// A touch screen (phone, tablet) or a mouse/trackpad as the primary pointer.
const stubPointer = (coarse: boolean) => {
  const native = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const list = native(query);
    if (query === "(pointer: coarse)") {
      Object.defineProperty(list, "matches", { value: coarse });
    }
    return list;
  });
};

const renderComposer = () => {
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
  const input = screen.getByRole("textbox", {
    name: "Message Mara",
  }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "see you at 3" } });
  return input;
};

const posted = () =>
  mocks.mutation.mock.calls.filter(([name]) => name === POST).length;

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue("message_1");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MessageComposer Enter key", () => {
  it("sends on Enter with a mouse or trackpad, and the keyboard says Send", async () => {
    stubPointer(false);
    const input = renderComposer();
    expect(input.getAttribute("enterkeyhint")).toBe("send");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(
        POST,
        expect.objectContaining({ body: "see you at 3" }),
      ),
    );
  });

  it("keeps Enter for a new line on a touch screen", () => {
    stubPointer(true);
    const input = renderComposer();
    expect(input.getAttribute("enterkeyhint")).toBe("enter");

    const notCancelled = fireEvent.keyDown(input, { key: "Enter" });
    // Not prevented: the browser inserts the line break.
    expect(notCancelled).toBe(true);
    expect(posted()).toBe(0);
    expect(input.value).toBe("see you at 3");
  });

  it("sends on Ctrl+Enter on a touch screen (a tablet's hardware keyboard)", async () => {
    stubPointer(true);
    const input = renderComposer();

    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(posted()).toBe(1));
  });

  it("does not send the Enter that confirms an IME composition", () => {
    stubPointer(false);
    const input = renderComposer();

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    // Safari ends a composition with an Enter keydown flagged only by keyCode 229.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(posted()).toBe(0);
    expect(input.value).toBe("see you at 3");
  });
});
