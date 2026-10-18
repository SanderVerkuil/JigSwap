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

// The composer feeds its value to useTypingIndicator; the hook's own rules are
// in use-typing-indicator.test.tsx.

const SET = getFunctionName(gateway.conversation.setTyping);
const CLEAR = getFunctionName(gateway.conversation.clearTyping);
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

const calls = () => mocks.mutation.mock.calls.map(([name]) => name);

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

describe("MessageComposer typing", () => {
  it("signals typing on input, clears when emptied, and lets a send clear it server-side", async () => {
    renderComposer();
    const input = screen.getByRole("textbox", { name: "Message Mara" });

    fireEvent.change(input, { target: { value: "H" } });
    fireEvent.change(input, { target: { value: "Hi" } });
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { threadId: "thread_1" });
    fireEvent.change(input, { target: { value: "" } });
    expect(calls()).toEqual([SET, CLEAR]);

    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls()).toContain(POST));
    // Retyping within 4 s of the last signal sends none (the leading edge holds
    // across a stop); postMessage clears the row, so the composer sends no
    // clearTyping of its own.
    expect(calls()).toEqual([SET, CLEAR, POST]);
  });
});
