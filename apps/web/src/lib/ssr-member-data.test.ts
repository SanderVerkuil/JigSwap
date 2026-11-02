// @vitest-environment node
import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONVEX_HOLD_MAX_MS,
  holdConvexUntilAuth,
  loadMemberDataOnServer,
  SSR_MEMBER_DATA_BUDGET_MS,
} from "./ssr-member-data";

const signedIn = (queryClient = new QueryClient()) => ({
  userId: "user_1",
  ssrAuthed: true,
  queryClient,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadMemberDataOnServer", () => {
  it("reads for a member the server holds a token for", async () => {
    const prefetch = vi.fn(async () => {});
    const context = signedIn();
    await loadMemberDataOnServer(context, async () => prefetch);
    expect(prefetch).toHaveBeenCalledExactlyOnceWith(context.queryClient);
  });

  it.each([
    ["signed out", { userId: null, ssrAuthed: false }],
    // Signed in, but no Convex token: the reads would run as nobody and put that in the page.
    ["without a token", { userId: "user_1", ssrAuthed: false }],
  ])("reads nothing %s", async (_, context) => {
    const prefetch = vi.fn(async () => {});
    await loadMemberDataOnServer(
      { ...context, queryClient: new QueryClient() },
      async () => prefetch,
    );
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("does nothing in the browser, so a navigation never waits on it", async () => {
    vi.stubGlobal("window", {});
    const prefetch = vi.fn(async () => {});
    await loadMemberDataOnServer(signedIn(), async () => prefetch);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("leaves a failed read to the browser instead of failing the page", async () => {
    await expect(
      loadMemberDataOnServer(
        signedIn(),
        async () => () => Promise.reject(new Error("backend down")),
      ),
    ).resolves.toBeUndefined();
  });

  it("leaves a prefetch that won't load to the browser too", async () => {
    await expect(
      loadMemberDataOnServer(signedIn(), () =>
        Promise.reject(new Error("chunk failed")),
      ),
    ).resolves.toBeUndefined();
  });

  it("stops waiting for a slow backend at the budget", async () => {
    vi.useFakeTimers();
    let settled = false;
    const loading = loadMemberDataOnServer(
      signedIn(),
      async () => () => new Promise(() => {}),
    ).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(SSR_MEMBER_DATA_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await loading;
    expect(settled).toBe(true);
  });

  // A read that outlives the budget must not change anything the page has decided on. The server's
  // HTML and the browser's first render start from what was in the cache at the budget.
  describe("a read still running at the budget", () => {
    const key = (name: string) => [name];

    it("never lands in the cache, while what finished in time stays", async () => {
      vi.useFakeTimers();
      const queryClient = new QueryClient();
      let land = (_: string) => {};
      const late = new Promise<string>((resolve) => {
        land = resolve;
      });
      const loading = loadMemberDataOnServer(
        signedIn(queryClient),
        async () => (client) =>
          Promise.allSettled([
            client.fetchQuery({
              queryKey: key("quick"),
              queryFn: async () => "in time",
            }),
            client.fetchQuery({ queryKey: key("slow"), queryFn: () => late }),
          ]),
      );
      await vi.advanceTimersByTimeAsync(SSR_MEMBER_DATA_BUDGET_MS);
      await loading;

      land("too late");
      await vi.advanceTimersByTimeAsync(50);
      expect(queryClient.getQueryData(key("quick"))).toBe("in time");
      expect(queryClient.getQueryData(key("slow"))).toBeUndefined();
      expect(queryClient.getQueryState(key("slow"))).toMatchObject({
        status: "pending",
        fetchStatus: "idle",
      });
    });

    it("doesn't lead to the reads chained behind it", async () => {
      vi.useFakeTimers();
      const next = vi.fn(async () => "next");
      const loading = loadMemberDataOnServer(
        signedIn(),
        async () => async (client) => {
          await client.fetchQuery({
            queryKey: key("me"),
            queryFn: () =>
              new Promise((resolve) => setTimeout(resolve, 10_000, "me")),
          });
          await client.fetchQuery({ queryKey: key("next"), queryFn: next });
        },
      );
      await vi.advanceTimersByTimeAsync(SSR_MEMBER_DATA_BUDGET_MS);
      await loading;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(next).not.toHaveBeenCalled();
    });

    it("starts no read when loading the prefetch took the whole budget", async () => {
      vi.useFakeTimers();
      const prefetch = vi.fn(async () => {});
      const loading = loadMemberDataOnServer(
        signedIn(),
        () => new Promise((resolve) => setTimeout(resolve, 1_000, prefetch)),
      );
      await vi.advanceTimersByTimeAsync(SSR_MEMBER_DATA_BUDGET_MS);
      await loading;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(prefetch).not.toHaveBeenCalled();
    });

    // The route's real integration: what doesn't make dehydrate() must not follow by stream either.
    it("isn't streamed to the browser after the page's data went out", async () => {
      const queryClient = new QueryClient();
      let finishRendering = () => {};
      const router = {
        isServer: true,
        options: {} as {
          dehydrate?: () => Promise<{
            query: {
              initial?: unknown[];
              stream: ReadableStream<{ queryKey: unknown }[]>;
            };
          }>;
        },
        serverSsr: {
          onRenderFinished: (callback: () => void) => {
            finishRendering = callback;
          },
        },
      };
      setupRouterSsrQueryIntegration({
        router: router as never,
        queryClient,
        dehydrateOptions: { shouldDehydrateQuery: defaultShouldDehydrateQuery },
      });
      let land = (_: string) => {};
      const late = new Promise<string>((resolve) => {
        land = resolve;
      });
      await loadMemberDataOnServer(
        signedIn(queryClient),
        async () => (client) =>
          client.fetchQuery({ queryKey: key("slow"), queryFn: () => late }),
      );
      const dehydrated = await router.options.dehydrate?.();
      expect(dehydrated?.query.initial).toBeUndefined();
      const reader = dehydrated?.query.stream.getReader();

      land("too late");
      await new Promise((resolve) => setTimeout(resolve, 5));
      finishRendering();

      const streamed: unknown[] = [];
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        streamed.push(chunk.value);
      }
      expect(streamed).toEqual([]);
    });
  });
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
