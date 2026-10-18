import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { FakeInvitationGateway } from "./invitations/adapters/fakeInvitationGateway";
import { makeFakeInvitationGateway } from "./invitations/adapters/fakeInvitationGateway";
import {
  emailHmacOf,
  RESPONSE_FLOOR_JITTER_MS,
  RESPONSE_FLOOR_MS,
  responseFloorFrom,
  SEND_LOG_WINDOW_MS,
} from "./invitations/config";
import {
  CLERK_INVITES_HOURLY_CAP_DEFAULT,
  RATE_LIMITS,
} from "./lib/rateLimits";
import schema from "./schema";

// Email invitations (#222, spec E.1): sendEmailInvite, listMyEmailInvites, revokeEmailInvite,
// getEmailInviteAvailability and the scheduled expiry. Clerk is never reached: the gateway factory
// is replaced by the in-memory fake, and AhaSend by a stubbed fetch. The keys below are dummy,
// non-secret test values.

const gate = vi.hoisted(() => ({
  gateway: null as FakeInvitationGateway | null,
}));
vi.mock("./invitations/adapters/invitationGateway", async (orig) => ({
  ...(await orig<typeof import("./invitations/adapters/invitationGateway")>()),
  makeInvitationGatewayFromEnv: () => {
    if (gate.gateway === null) throw new Error("gateway factory exploded");
    return gate.gateway;
  },
}));

// The response floor's sleep is replaced, so tests run at full speed and can see what it was asked.
const timing = vi.hoisted(() => ({
  waitUntil: vi.fn(async (_until: number) => {}),
}));
vi.mock("./invitations/config", async (orig) => ({
  ...(await orig<typeof import("./invitations/config")>()),
  waitUntil: timing.waitUntil,
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol";

const HMAC_KEY = "test-only-dummy-invite-email-hmac-key-0123456789";
const NEW_ADDRESS = "newbie@example.org";

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: [] }), { status: 202 }),
);
let logged: string[] = [];
let gateway: FakeInvitationGateway;

beforeEach(() => {
  gateway = makeFakeInvitationGateway();
  gate.gateway = gateway;
  timing.waitUntil.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INVITE_EMAIL_HMAC_KEY", HMAC_KEY);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy_not_a_real_key");
  vi.stubEnv("AHASEND_API_KEY", "aha-sk-test");
  vi.stubEnv("AHASEND_ACCOUNT_ID", "acc-1");
  vi.stubEnv("EMAIL_BASE_URL", "https://jigswap.site");
  vi.stubEnv("AXIOM_API_KEY", "");
  logged = [];
  const capture = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const seed = async (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: Who, extra: Partial<Doc<"users">> = {}) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who[0].toUpperCase() + who.slice(1),
        username: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    return {
      alice: await mk("alice"),
      bob: await mk("bob"),
      carol: await mk("carol"),
    };
  });

// Alice admins a household with Bob as a plain member.
const seedHousehold = (t: T, admin: Id<"users">, member: Id<"users">) =>
  t.run(async (ctx) => {
    const householdId = "hh_1";
    await ctx.db.insert("households", {
      aggregateId: householdId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("householdMembers", {
      householdId,
      memberId: admin,
      role: "admin",
      joinedAt: Date.now(),
    });
    await ctx.db.insert("householdMembers", {
      householdId,
      memberId: member,
      role: "member",
      joinedAt: Date.now(),
    });
    return householdId;
  });

const send = (
  t: T,
  who: Who,
  email: string,
  kind: "follow" | "household" = "follow",
) =>
  as(t, who).action(api.invitations.sendEmailInvite.sendEmailInvite, {
    kind,
    email,
  });

const list = (t: T, who: Who, kind: "follow" | "household" = "follow") =>
  as(t, who).query(api.invitations.listMyEmailInvites.listMyEmailInvites, {
    kind,
  });

const rowsOf = (t: T) => t.run((ctx) => ctx.db.query("emailInvites").collect());

const sendLog = (t: T) =>
  t.run((ctx) => ctx.db.query("emailInviteSendLog").collect());

const errorOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<string | { code: string }>).data;
};
const codeOf = async (promise: Promise<unknown>) => {
  const data = await errorOf(promise);
  return typeof data === "string" ? data : (data as { code: string }).code;
};

type SentEmail = {
  recipients: { email: string; name?: string }[];
  from: { name: string };
  subject: string;
  html_content: string;
  text_content: string;
};
const sentEmails = (): SentEmail[] =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).startsWith("https://api.ahasend.com/"))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

const settleDueJobs = async (t: T) => {
  for (let i = 0; i < 200; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const busy = jobs.some(
      (job) =>
        job.state.kind === "inProgress" ||
        (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
    );
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scheduled functions did not settle");
};

describe("auth", () => {
  test("every public function refuses or reveals nothing without a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    expect(
      await codeOf(
        t.action(api.invitations.sendEmailInvite.sendEmailInvite, {
          kind: "follow",
          email: NEW_ADDRESS,
        }),
      ),
    ).toBe("Unauthenticated");
    expect(
      await codeOf(
        t.query(api.invitations.listMyEmailInvites.listMyEmailInvites, {
          kind: "follow",
        }),
      ),
    ).toBe("Unauthenticated");
    expect(
      await codeOf(
        t.action(api.invitations.revokeEmailInvite.revokeEmailInvite, {
          inviteRef: "any",
        }),
      ),
    ).toBe("Unauthenticated");
    expect(
      await t.query(
        api.invitations.getEmailInviteAvailability.getEmailInviteAvailability,
        {},
      ),
    ).toBe(false);
    expect(await rowsOf(t)).toEqual([]);
    expect(gateway.created).toEqual([]);
  });

  test("a signed-in identity without a member row is refused", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const ghost = t.withIdentity({ subject: "clerk_ghost" });
    expect(
      await codeOf(
        ghost.action(api.invitations.sendEmailInvite.sendEmailInvite, {
          kind: "follow",
          email: NEW_ADDRESS,
        }),
      ),
    ).toBe("Member not found");
  });
});

describe("the feature switch", () => {
  const availability = (t: T) =>
    as(t, "alice").query(
      api.invitations.getEmailInviteAvailability.getEmailInviteAvailability,
      {},
    );

  test("on with both keys: available to a signed-in member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await availability(t)).toBe(true);
  });

  test.each([
    ["INVITE_EMAIL_HMAC_KEY", ""],
    ["INVITE_EMAIL_HMAC_KEY", "too-short-key"],
    ["CLERK_SECRET_KEY", ""],
  ])("off when %s is %j", async (name, value) => {
    const t = convexTest(schema, modules);
    await seed(t);
    vi.stubEnv(name, value);

    expect(await availability(t)).toBe(false);
    expect(await codeOf(send(t, "alice", NEW_ADDRESS))).toBe(
      "EmailInvitesUnavailable",
    );
    expect(await rowsOf(t)).toEqual([]);
    expect(gateway.created).toEqual([]);
    expect(sentEmails()).toEqual([]);
  });
});

describe("sendEmailInvite", () => {
  test("a new address: one Clerk invitation, one email, one ref row", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    expect(await send(t, "alice", `  ${NEW_ADDRESS.toUpperCase()} `)).toEqual({
      status: "sent",
    });

    const [row] = await rowsOf(t);
    expect(row).toMatchObject({
      kind: "follow",
      inviterId: s.alice,
      clerkInvitationId: "inv_fake_1",
    });
    expect(row.expiresAt - row.createdAt).toBe(14 * 24 * 60 * 60_000);
    expect(gateway.created).toEqual([
      {
        email: NEW_ADDRESS,
        redirectUrl: "https://jigswap.site/sign-up",
        expiresInDays: 14,
        publicMetadata: { jsInvite: { kind: "follow", ref: row.aggregateId } },
      },
    ]);

    const [email] = sentEmails();
    expect(sentEmails()).toHaveLength(1);
    expect(email.recipients).toEqual([{ email: NEW_ADDRESS }]);
    expect(email.subject).toBe("Alice invited you to JigSwap");
    expect(email.from.name).toBe("JigSwap");
    expect(email.html_content).toContain(
      "https://clerk.example/v1/tickets/accept?ticket=inv_fake_1",
    );
    expect(email.text_content).toContain("to follow each other");
    expect(await sendLog(t)).toHaveLength(1);
  });

  test("the email is in the inviter's language", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.alice, { preferredLanguage: "nl" }));

    await send(t, "alice", NEW_ADDRESS);

    expect(sentEmails()[0].subject).toBe("Alice nodigt je uit voor JigSwap");
  });

  test("the subject's only member text is the sanitised inviter name", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(s.alice, {
        name: `Alice\r\nBcc: evil@example.com ${"x".repeat(80)}`,
      }),
    );

    await send(t, "alice", NEW_ADDRESS);

    const { subject } = sentEmails()[0];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toMatch(
      /^Alice Bcc: evil@example.com x+… invited you to JigSwap$/,
    );
  });

  test("an invalid address is InvalidEmail, and costs nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    for (const email of ["not-an-email", "a@b@c", "x".repeat(250) + "@e.com"]) {
      expect(await codeOf(send(t, "alice", email))).toBe("InvalidEmail");
    }
    expect(await rowsOf(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("rateLimits").collect())).toEqual(
      [],
    );
  });

  test("household: only the household admin may invite, with an error about the inviter", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    expect(await codeOf(send(t, "alice", NEW_ADDRESS, "household"))).toBe(
      "NotInHousehold",
    );
    const householdId = await seedHousehold(t, s.alice, s.bob);
    expect(await codeOf(send(t, "bob", NEW_ADDRESS, "household"))).toBe(
      "NotHouseholdAdmin",
    );
    expect(await rowsOf(t)).toEqual([]);

    expect(await send(t, "alice", NEW_ADDRESS, "household")).toEqual({
      status: "sent",
    });
    const [row] = await rowsOf(t);
    expect(row).toMatchObject({ kind: "household", householdId });
    expect(gateway.created[0].publicMetadata).toEqual({
      jsInvite: { kind: "household", ref: row.aggregateId },
    });
    expect(sentEmails()[0].subject).toBe(
      "Alice invited you to their household on JigSwap",
    );
  });

  test("rate limit: 10 a day per inviter, follow and household together", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);
    expect(RATE_LIMITS.emailInvite).toEqual({
      windowMs: 24 * 60 * 60_000,
      max: 10,
    });

    for (let i = 0; i < 10; i++) {
      await send(
        t,
        "alice",
        `person${i}@example.org`,
        i % 2 ? "household" : "follow",
      );
    }
    const data = (await errorOf(send(t, "alice", "one-more@example.org"))) as {
      code: string;
      retryAfterMs: number;
    };
    expect(data.code).toBe("RateLimited");
    expect(data.retryAfterMs).toBeGreaterThan(0);
    expect(await rowsOf(t)).toHaveLength(10);

    // Bob's own allowance is untouched.
    expect(await send(t, "bob", "for-bob@example.org")).toEqual({
      status: "sent",
    });
  });

  test("the rate-limit count and the ref row commit, and the answer is sent, when a later step throws", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    gate.gateway = null;

    expect(await send(t, "alice", NEW_ADDRESS)).toEqual({ status: "sent" });
    expect(logged.join("\n")).not.toContain("gateway factory exploded");

    const limits = await t.run((ctx) => ctx.db.query("rateLimits").collect());
    expect(
      limits
        .filter((row) => row.key.startsWith("emailInvite:"))
        .map((row) => row.count),
    ).toEqual([1]);
    expect(await rowsOf(t)).toHaveLength(1);
  });

  test("the deployment-wide Clerk budget: over it, no Clerk call and no email, still sent", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(CLERK_INVITES_HOURLY_CAP_DEFAULT).toBe(60);
    vi.stubEnv("CLERK_INVITES_HOURLY_CAP", "2");

    await send(t, "alice", "one@example.org");
    await send(t, "bob", "two@example.org");
    // An existing member's address doesn't reach Clerk, so it costs nothing.
    await send(t, "bob", "carol@example.com");
    expect(await send(t, "carol", "three@example.org")).toEqual({
      status: "sent",
    });

    expect(gateway.created.map((input) => input.email)).toEqual([
      "one@example.org",
      "two@example.org",
    ]);
    expect(sentEmails()).toHaveLength(2);
    expect(
      logged.some(
        (line) =>
          line.includes('"rateLimit.refused"') &&
          line.includes('"clerkInvites:global:hour"'),
      ),
    ).toBe(true);
    expect(await list(t, "carol")).toHaveLength(1);
  });

  test("a Clerk failure still answers sent, and sends nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    gateway.nextCreate = "error";

    expect(await send(t, "alice", NEW_ADDRESS)).toEqual({ status: "sent" });
    expect(sentEmails()).toEqual([]);
    expect(await sendLog(t)).toEqual([]);
    expect(await list(t, "alice")).toHaveLength(1);
  });

  test("per-address cap: one invitation email per 30 days across inviters", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await send(t, "alice", NEW_ADDRESS);
    expect(await send(t, "bob", NEW_ADDRESS.toUpperCase())).toEqual({
      status: "sent",
    });

    expect(sentEmails()).toHaveLength(1);
    expect(gateway.created).toHaveLength(1);
    // Each inviter still sees their own pending row.
    expect(await list(t, "alice")).toHaveLength(1);
    expect(await list(t, "bob")).toHaveLength(1);
    const [log] = await sendLog(t);
    expect(log.emailHmac).toBe(await emailHmacOf(HMAC_KEY, NEW_ADDRESS));
  });

  test("a send-log row older than 30 days no longer caps, and its cleanup deletes it", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const emailHmac = await emailHmacOf(HMAC_KEY, NEW_ADDRESS);
    const old = await t.run((ctx) =>
      ctx.db.insert("emailInviteSendLog", {
        emailHmac,
        sentAt: Date.now() - SEND_LOG_WINDOW_MS - 1000,
      }),
    );

    await send(t, "alice", NEW_ADDRESS);
    expect(sentEmails()).toHaveLength(1);

    const cleanups = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter((job) => job.name.endsWith("deleteSendLogEntry"));
    const fresh = (await sendLog(t)).find((row) => row._id !== old);
    expect(cleanups.map((job) => job.scheduledTime)).toEqual([
      (fresh?.sentAt ?? 0) + SEND_LOG_WINDOW_MS,
    ]);

    // The cleanup leaves a row inside its window alone, and deletes a lapsed one.
    for (const id of [old, fresh!._id]) {
      await t.mutation(
        internal.invitations.emailInviteStore.deleteSendLogEntry,
        { id },
      );
    }
    expect((await sendLog(t)).map((row) => row._id)).toEqual([fresh!._id]);
  });

  test("an existing member's address: same answer, same pending row, no email, no Clerk call", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const forMember = await send(t, "alice", "carol@example.com");
    const forNewcomer = await send(t, "alice", NEW_ADDRESS);

    expect(forMember).toEqual(forNewcomer);
    expect(gateway.created.map((input) => input.email)).toEqual([NEW_ADDRESS]);
    expect(sentEmails().map((email) => email.recipients)).toEqual([
      [{ email: NEW_ADDRESS }],
    ]);

    const views = await list(t, "alice");
    expect(views).toHaveLength(2);
    const [a, b] = views;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "inviteRef",
      "kind",
    ]);
    expect(b.expiresAt - b.createdAt).toBe(a.expiresAt - a.createdAt);
  });

  test("Clerk says the address already exists: no email, still sent", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    gateway.nextCreate = "exists";

    expect(await send(t, "alice", NEW_ADDRESS)).toEqual({ status: "sent" });
    expect(sentEmails()).toEqual([]);
    expect(await sendLog(t)).toEqual([]);
    expect(await list(t, "alice")).toHaveLength(1);
  });

  test("Clerk returns no link: the invitation is revoked, no email, still sent", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    gateway.nextCreate = "no_url";

    expect(await send(t, "alice", NEW_ADDRESS)).toEqual({ status: "sent" });
    expect(gateway.revoked).toEqual(["inv_fake_1"]);
    expect(gateway.deleted).toEqual(["inv_fake_1"]);
    expect(sentEmails()).toEqual([]);
    expect(await sendLog(t)).toEqual([]);
    expect(logged.some((line) => line.includes('"emailInvite.no_url"'))).toBe(
      true,
    );
  });

  test("without a mail provider nothing is created or sent", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    vi.stubEnv("AHASEND_API_KEY", "");

    expect(await send(t, "alice", NEW_ADDRESS)).toEqual({ status: "sent" });
    expect(gateway.created).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a failed email send revokes the invitation and records no send", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    fetchMock.mockImplementationOnce(
      async () => new Response(`bad recipient ${NEW_ADDRESS}`, { status: 422 }),
    );

    expect(await send(t, "alice", NEW_ADDRESS)).toEqual({ status: "sent" });
    expect(gateway.revoked).toEqual(["inv_fake_1"]);
    expect(gateway.deleted).toEqual(["inv_fake_1"]);
    expect(await sendLog(t)).toEqual([]);
    expect(logged.join("\n")).not.toContain(NEW_ADDRESS);
  });

  test("no table stores the address, and no log line carries it, its HMAC or the link", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const forMember = "carol@example.com";

    await send(t, "alice", NEW_ADDRESS);
    await send(t, "alice", forMember);
    gateway.nextCreate = "no_url";
    await send(t, "bob", "another@example.org");
    await settleDueJobs(t);

    const dump = await t.run(async (ctx) => {
      const rows: unknown[] = [];
      for (const table of Object.keys(schema.tables)) {
        if (table === "users") continue;
        rows.push(
          ...(await ctx.db
            .query(table as keyof typeof schema.tables)
            .collect()),
        );
      }
      rows.push(
        ...(await ctx.db.system.query("_scheduled_functions").collect()),
      );
      return JSON.stringify(rows).toLowerCase();
    });
    for (const address of [NEW_ADDRESS, forMember, "another@example.org"]) {
      expect(dump).not.toContain(address);
    }
    // The users table holds only the members' own verified addresses.
    const userEmails = await t.run(async (ctx) =>
      (await ctx.db.query("users").collect()).map((user) => user.email),
    );
    expect(userEmails).not.toContain(NEW_ADDRESS);

    const log = logged.join("\n");
    for (const secret of [
      NEW_ADDRESS,
      "another@example.org",
      forMember,
      await emailHmacOf(HMAC_KEY, NEW_ADDRESS),
      "https://clerk.example/",
    ]) {
      expect(log).not.toContain(secret);
    }
    expect(log).toContain('"invitations.sendEmailInvite"');
  });
});

describe("listMyEmailInvites", () => {
  test("only the inviter's own rows of that kind, newest first, lapsed rows left out", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedHousehold(t, s.alice, s.bob);

    await send(t, "alice", "one@example.org");
    await send(t, "alice", "two@example.org");
    await send(t, "alice", "three@example.org", "household");
    await send(t, "bob", "four@example.org");

    const follow = await list(t, "alice");
    expect(follow.map((view) => view.kind)).toEqual(["follow", "follow"]);
    expect(follow[0].createdAt).toBeGreaterThanOrEqual(follow[1].createdAt);
    expect(await list(t, "alice", "household")).toHaveLength(1);
    expect(await list(t, "bob")).toHaveLength(1);

    await t.run(async (ctx) => {
      const row = (await ctx.db.query("emailInvites").collect()).find(
        (r) => r.aggregateId === follow[0].inviteRef,
      );
      await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
    });
    expect((await list(t, "alice")).map((view) => view.inviteRef)).toEqual([
      follow[1].inviteRef,
    ]);
  });
});

describe("revokeEmailInvite", () => {
  test("the inviter revokes: the row goes and the Clerk invitation is revoked", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", NEW_ADDRESS);
    const [view] = await list(t, "alice");

    expect(
      await as(t, "alice").action(
        api.invitations.revokeEmailInvite.revokeEmailInvite,
        { inviteRef: view.inviteRef },
      ),
    ).toBeNull();

    expect(await rowsOf(t)).toEqual([]);
    expect(gateway.revoked).toEqual(["inv_fake_1"]);
    expect(gateway.deleted).toEqual(["inv_fake_1"]);
    expect(await list(t, "alice")).toEqual([]);
  });

  test("a revoke that fails at Clerk still deletes the invitation there and removes the row", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", NEW_ADDRESS);
    const [view] = await list(t, "alice");
    gateway.failRevoke = true;

    await as(t, "alice").action(
      api.invitations.revokeEmailInvite.revokeEmailInvite,
      { inviteRef: view.inviteRef },
    );
    expect(await rowsOf(t)).toEqual([]);
    expect(gateway.deleted).toEqual(["inv_fake_1"]);
  });

  test("an existing member's row revokes the same way, with no Clerk call", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", "carol@example.com");
    const [view] = await list(t, "alice");

    await as(t, "alice").action(
      api.invitations.revokeEmailInvite.revokeEmailInvite,
      { inviteRef: view.inviteRef },
    );
    expect(await rowsOf(t)).toEqual([]);
    expect(gateway.revoked).toEqual([]);
    expect(gateway.deleted).toEqual([]);
  });

  test("someone else's ref, an unknown ref and a revoked ref get the same generic error", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", NEW_ADDRESS);
    const [view] = await list(t, "alice");
    const revoke = (who: Who, inviteRef: string) =>
      as(t, who).action(api.invitations.revokeEmailInvite.revokeEmailInvite, {
        inviteRef,
      });

    expect(await codeOf(revoke("bob", view.inviteRef))).toBe(
      "EmailInviteUnavailable",
    );
    expect(await codeOf(revoke("bob", "no-such-ref"))).toBe(
      "EmailInviteUnavailable",
    );
    expect(await rowsOf(t)).toHaveLength(1);
    expect(gateway.revoked).toEqual([]);
    expect(gateway.deleted).toEqual([]);

    await revoke("alice", view.inviteRef);
    expect(await codeOf(revoke("alice", view.inviteRef))).toBe(
      "EmailInviteUnavailable",
    );
  });
});

describe("expiry", () => {
  test("each send schedules its expiry at expiresAt", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", NEW_ADDRESS);
    const [row] = await rowsOf(t);

    const jobs = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    ).filter((job) => job.name.endsWith("expireEmailInvite"));
    expect(jobs.map((job) => [job.scheduledTime, job.args[0]])).toEqual([
      [row.expiresAt, { inviteRef: row.aggregateId }],
    ]);
  });

  test("at expiry the row is deleted and the Clerk invitation revoked", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await send(t, "alice", NEW_ADDRESS);
    const [row] = await rowsOf(t);
    const expire = () =>
      t.mutation(internal.invitations.emailInviteStore.expireEmailInvite, {
        inviteRef: row.aggregateId,
      });

    // Not due yet: nothing happens.
    await expire();
    expect(await rowsOf(t)).toHaveLength(1);

    await t.run((ctx) => ctx.db.patch(row._id, { expiresAt: Date.now() - 1 }));
    await expire();
    await settleDueJobs(t);
    expect(await rowsOf(t)).toEqual([]);
    expect(gateway.revoked).toEqual(["inv_fake_1"]);
    expect(gateway.deleted).toEqual(["inv_fake_1"]);

    // Already gone: a no-op.
    await expire();
    await settleDueJobs(t);
    expect(gateway.revoked).toEqual(["inv_fake_1"]);
    expect(gateway.deleted).toEqual(["inv_fake_1"]);
  });
});

describe("the response floor", () => {
  test("is RESPONSE_FLOOR_MS plus up to RESPONSE_FLOOR_JITTER_MS after the start", () => {
    expect(RESPONSE_FLOOR_MS).toBe(2500);
    expect(RESPONSE_FLOOR_JITTER_MS).toBe(500);
    expect(responseFloorFrom(1000, () => 0)).toBe(3500);
    expect(responseFloorFrom(1000, () => 0.5)).toBe(3750);
    expect(responseFloorFrom(1000, () => 1)).toBe(4000);
  });

  test("waitUntil sleeps until the instant, and not at all once it has passed", async () => {
    const { waitUntil } = await vi.importActual<
      typeof import("./invitations/config")
    >("./invitations/config");
    let start = Date.now();
    await waitUntil(start - 1000);
    expect(Date.now() - start).toBeLessThan(20);
    start = Date.now();
    await waitUntil(start + 40);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  // Each setup leads sendEmailInvite down one path after its first mutation; every one must end in
  // the same answer after the same floor.
  const paths: [string, (t: T) => Promise<void>, string][] = [
    ["emailed", async () => {}, NEW_ADDRESS],
    ["existing member", async () => {}, "carol@example.com"],
    [
      "address capped",
      async (t) => {
        await send(t, "bob", NEW_ADDRESS);
        timing.waitUntil.mockClear();
      },
      NEW_ADDRESS,
    ],
    [
      "clerk exists",
      async () => {
        gateway.nextCreate = "exists";
      },
      NEW_ADDRESS,
    ],
    [
      "clerk no_url",
      async () => {
        gateway.nextCreate = "no_url";
      },
      NEW_ADDRESS,
    ],
    [
      "clerk error",
      async () => {
        gateway.nextCreate = "error";
      },
      NEW_ADDRESS,
    ],
    [
      "send failed",
      async () => {
        fetchMock.mockImplementationOnce(
          async () => new Response("no", { status: 500 }),
        );
      },
      NEW_ADDRESS,
    ],
    [
      "email unconfigured",
      async () => {
        vi.stubEnv("AHASEND_API_KEY", "");
      },
      NEW_ADDRESS,
    ],
    [
      "clerk budget spent",
      async (t) => {
        vi.stubEnv("CLERK_INVITES_HOURLY_CAP", "1");
        await send(t, "bob", "spends-it@example.org");
        timing.waitUntil.mockClear();
      },
      NEW_ADDRESS,
    ],
    [
      "a throw inside delivery",
      async () => {
        gate.gateway = null;
      },
      NEW_ADDRESS,
    ],
  ];

  test.each(paths)(
    "%s: answers sent after the floor",
    async (_label, arrange, email) => {
      const t = convexTest(schema, modules);
      await seed(t);
      await arrange(t);

      const before = Date.now();
      expect(await send(t, "alice", email)).toEqual({ status: "sent" });
      const after = Date.now();

      expect(timing.waitUntil).toHaveBeenCalledTimes(1);
      const [until] = timing.waitUntil.mock.calls[0];
      expect(until).toBeGreaterThanOrEqual(before + RESPONSE_FLOOR_MS);
      expect(until).toBeLessThanOrEqual(
        after + RESPONSE_FLOOR_MS + RESPONSE_FLOOR_JITTER_MS,
      );
    },
  );

  test("a refusal about the inviter or the input answers at once", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await codeOf(send(t, "alice", "not-an-email"))).toBe("InvalidEmail");
    expect(timing.waitUntil).not.toHaveBeenCalled();
  });
});
