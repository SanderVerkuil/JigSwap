// @vitest-environment node
import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONVEX_HOLD_MAX_MS, holdConvexUntilAuth } from "./ssr-member-data";

afterEach(() => {
  vi.useRealTimers();
});

describe("holdConvexUntilAuth", () => {
  // A socket that opens at once and records what the client sends.
  class FakeSocket {
    static last: FakeSocket;
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = FakeSocket.CONNECTING;
    sent: { type: string }[] = [];
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor() {
      FakeSocket.last = this;
      queueMicrotask(() => {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.({});
      });
    }
    send(data: string) {
      this.sent.push(JSON.parse(data) as { type: string });
    }
    close() {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.({ code: 1000, reason: "" });
    }
    types() {
      return this.sent.map((message) => message.type);
    }
  }

  const client = () =>
    new ConvexReactClient("https://held.convex.cloud", {
      webSocketConstructor: FakeSocket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
    });
  const myMember = makeFunctionReference<"query">("identity:currentUser");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("sends a hydrated query nothing until the real token is in, then the token first", async () => {
    const convex = client();
    holdConvexUntilAuth(convex);
    // What hydrating a server-loaded query does.
    convex.watchQuery(myMember, {}).onUpdate(() => {});
    await settle();
    expect(FakeSocket.last.types()).not.toContain("ModifyQuerySet");

    // ConvexProviderWithClerk's first effect.
    let giveToken = (_token: string | null) => {};
    convex.setAuth(
      () =>
        new Promise((resolve) => {
          giveToken = resolve;
        }),
    );
    await settle();
    expect(FakeSocket.last.types()).not.toContain("ModifyQuerySet");

    // A JWT-shaped token whose expiry the client can read.
    const claims = btoa(JSON.stringify({ iat: 1, exp: 4102444800 }));
    giveToken(`h.${claims}.s`);
    await settle();
    const types = FakeSocket.last.types();
    expect(types).toContain("ModifyQuerySet");
    expect(types.indexOf("Authenticate")).toBeLessThan(
      types.indexOf("ModifyQuerySet"),
    );
    await convex.close();
  });

  it("lets go by itself if nothing ever takes over", async () => {
    vi.useFakeTimers();
    const convex = client();
    holdConvexUntilAuth(convex);
    convex.watchQuery(myMember, {}).onUpdate(() => {});
    await vi.advanceTimersByTimeAsync(CONVEX_HOLD_MAX_MS - 1);
    expect(FakeSocket.last.types()).not.toContain("ModifyQuerySet");
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.last.types()).toContain("ModifyQuerySet");
    vi.useRealTimers();
    await convex.close();
  });

  it("lets go when Clerk has no token after all: the page reads as nobody, not never", async () => {
    const convex = client();
    holdConvexUntilAuth(convex);
    convex.watchQuery(myMember, {}).onUpdate(() => {});
    convex.setAuth(() => Promise.resolve(null));
    await settle();
    expect(FakeSocket.last.types()).toContain("ModifyQuerySet");
    await convex.close();
  });
});
