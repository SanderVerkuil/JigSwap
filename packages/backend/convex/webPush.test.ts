import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SUBJECT,
  isAllowedPushEndpoint,
  isGoneStatus,
  isValidPushKeys,
  noopWebPushSender,
  notificationUrl,
  toWebPushPayload,
  vapidConfigFromEnv,
} from "./notifications/adapters/webPush";

describe("vapidConfigFromEnv", () => {
  test("returns null when the keypair is incomplete", () => {
    expect(vapidConfigFromEnv({})).toBeNull();
    expect(vapidConfigFromEnv({ VAPID_PUBLIC_KEY: "pub" })).toBeNull();
    expect(vapidConfigFromEnv({ VAPID_PRIVATE_KEY: "priv" })).toBeNull();
  });

  test("reads the keypair and a custom subject", () => {
    expect(
      vapidConfigFromEnv({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:ops@example.com",
      }),
    ).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:ops@example.com",
    });
  });

  test("falls back to the default subject when unset", () => {
    expect(
      vapidConfigFromEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })
        ?.subject,
    ).toBe(DEFAULT_SUBJECT);
  });
});

describe("noopWebPushSender", () => {
  test("logs and reports a benign no-op (never asks to prune)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await noopWebPushSender("test").send(
      { endpoint: "e", p256dh: "p", auth: "a" },
      { title: "t", body: "b", type: "x", url: "/notifications", tag: "x" },
    );
    expect(result).toEqual({ ok: false, gone: false, statusCode: null });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("isGoneStatus", () => {
  test("only 404 and 410 are permanently gone", () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(429)).toBe(false);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(201)).toBe(false);
  });
});

describe("notificationUrl", () => {
  test("routes the trade/exchange family to /trades", () => {
    expect(notificationUrl("trade_request")).toBe("/trades");
    expect(notificationUrl("exchange_disputed")).toBe("/trades");
  });

  test("deep-links an approved puzzle by relatedId, else the catalog", () => {
    expect(notificationUrl("puzzle_approved", "pz-1")).toBe("/puzzles/pz-1");
    expect(notificationUrl("puzzle_approved")).toBe("/puzzles");
  });

  test("falls back to the in-app feed for unknown types", () => {
    expect(notificationUrl("totally_unknown")).toBe("/notifications");
  });

  test("routes the follow family to /people (requests strip)", () => {
    expect(notificationUrl("new_follower")).toBe("/people");
    expect(notificationUrl("follow_request_received")).toBe("/people");
    expect(notificationUrl("follow_request_approved")).toBe("/people");
    expect(notificationUrl("connection_offer_received")).toBe("/people");
  });

  test("routes household invites to /household", () => {
    expect(notificationUrl("household_invite_received")).toBe("/household");
    expect(notificationUrl("household_invite_accepted")).toBe("/household");
  });

  test("deep-links a What's new notification to its entry anchor, else the page", () => {
    expect(notificationUrl("whats_new", "households")).toBe(
      "/whats-new#entry-households",
    );
    expect(notificationUrl("whats_new")).toBe("/whats-new");
  });

  test("deep-links an admin proposal review by relatedId, else the proposals queue", () => {
    expect(notificationUrl("admin_proposal_filed", "cp-1")).toBe(
      "/admin/puzzles/proposals/cp-1",
    );
    expect(notificationUrl("admin_proposal_filed")).toBe(
      "/admin/puzzles/proposals",
    );
  });

  test("routes an admin submission review to the moderation console", () => {
    expect(notificationUrl("admin_definition_submitted", "pz-1")).toBe(
      "/admin/moderation",
    );
    expect(notificationUrl("admin_definition_submitted")).toBe(
      "/admin/moderation",
    );
  });

  test("deep-links a proposal outcome to the targeted definition, else the catalog", () => {
    expect(notificationUrl("proposal_approved", "pz-1")).toBe("/puzzles/pz-1");
    expect(notificationUrl("proposal_rejected", "pz-1")).toBe("/puzzles/pz-1");
    expect(notificationUrl("proposal_approved")).toBe("/puzzles");
    expect(notificationUrl("proposal_rejected")).toBe("/puzzles");
  });
});

describe("toWebPushPayload", () => {
  test("maps title/message/type and computes the click URL", () => {
    expect(
      toWebPushPayload({
        title: "New message",
        message: "Bob sent you a message",
        type: "message_received",
        relatedId: "conv-1",
      }),
    ).toEqual({
      title: "New message",
      body: "Bob sent you a message",
      type: "message_received",
      relatedId: "conv-1",
      url: "/messages",
      tag: "message_received",
    });
  });

  test("tags a thread's pushes with the thread, so the OS replaces instead of stacking", () => {
    const base = { title: "New messages", message: "Hi", relatedId: "t-1" };
    expect(
      toWebPushPayload({
        ...base,
        type: "circle_message_received",
        subject: { kind: "thread", threadId: "t-1" },
      }).tag,
    ).toBe("thread:t-1");
    expect(
      toWebPushPayload({
        ...base,
        type: "message_received",
        subject: { kind: "thread", threadId: "t-2" },
      }).tag,
    ).toBe("thread:t-2");
    // Not a thread: one tag per type, as before.
    expect(
      toWebPushPayload({
        ...base,
        type: "trade_accepted",
        subject: { kind: "exchange" },
      }).tag,
    ).toBe("trade_accepted");
  });

  test("uses the resolved deep link when given, else the per-type URL", () => {
    const base = {
      title: "New message",
      message: "Hi",
      type: "message_received",
      relatedId: "thread-1",
    };
    expect(toWebPushPayload({ ...base, url: "/messages/thread-1" }).url).toBe(
      "/messages/thread-1",
    );
    expect(toWebPushPayload({ ...base, url: null }).url).toBe("/messages");
  });
});

// Base64url without padding, as PushSubscription.toJSON() emits it.
const b64url = (bytes: readonly number[]): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const bytes = (length: number, first = 7): number[] =>
  Array.from({ length }, (_, i) => (i === 0 ? first : (i * 37) % 256));

describe("isAllowedPushEndpoint", () => {
  test("accepts the browser push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/dXk3:APA91bH",
      "https://fcm.googleapis.com/wp/dXk3:APA91bH",
      "https://android.googleapis.com/gcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
      "https://web.push.apple.com/QGuQyavXutnMx",
      "https://api.push.apple.com/QGuQyavXutnMx",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2b",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  test("refuses other schemes, hosts, ports and the NOTIF-1 targets", () => {
    for (const endpoint of [
      "file:///etc/passwd",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://10.0.0.1:8443/internal",
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/",
      "https://tarpit.attacker.example/x",
      "https://push.example/abc",
      // Lookalikes: the allowlisted name must be the host, not a label or a prefix of it.
      "https://fcm.googleapis.com.attacker.example/x",
      "https://attacker-fcm.googleapis.com.example/x",
      "https://notify.windows.com.attacker.example/w",
      "https://evilpush.apple.com/x",
      // An explicit port, userinfo, or an authority a laxer parser could read differently.
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user@fcm.googleapis.com/fcm/send/abc",
      "https://attacker.example\\@fcm.googleapis.com/x",
      "https://FCM.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com",
      " https://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com/fcm/send/a b",
      "https://fcm.googleapis.com/fcm/send/\u00e9",
      "not a url",
      "",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });

  test("caps the endpoint at 2048 characters", () => {
    const base = "https://fcm.googleapis.com/fcm/send/";
    expect(isAllowedPushEndpoint(base + "x".repeat(2048 - base.length))).toBe(
      true,
    );
    expect(isAllowedPushEndpoint(base + "x".repeat(2049 - base.length))).toBe(
      false,
    );
    expect(isAllowedPushEndpoint(base + "x".repeat(20_000))).toBe(false);
  });
});

describe("isValidPushKeys", () => {
  const p256dh = b64url(bytes(65, 0x04));
  const auth = b64url(bytes(16));

  test("accepts a 65-byte uncompressed P-256 key and a 16-byte auth secret", () => {
    expect(isValidPushKeys({ p256dh, auth })).toBe(true);
    // Padded base64url decodes to the same bytes.
    expect(isValidPushKeys({ p256dh: `${p256dh}=`, auth: `${auth}==` })).toBe(
      true,
    );
  });

  test("refuses keys of the wrong length, encoding or point format", () => {
    for (const keys of [
      { p256dh: "pkey", auth },
      { p256dh, auth: "akey" },
      { p256dh: b64url(bytes(64, 0x04)), auth },
      { p256dh: b64url(bytes(66, 0x04)), auth },
      // A compressed point (0x02/0x03) or anything not starting 0x04.
      { p256dh: b64url(bytes(65, 0x02)), auth },
      { p256dh, auth: b64url(bytes(15)) },
      { p256dh, auth: b64url(bytes(32)) },
      // Standard base64 alphabet, whitespace, or junk.
      { p256dh: `+${p256dh.slice(1)}`, auth },
      { p256dh, auth: `/${auth.slice(1)}` },
      { p256dh: ` ${p256dh}`, auth },
      { p256dh, auth: `${auth}!` },
      { p256dh: "", auth: "" },
    ]) {
      expect(isValidPushKeys(keys), JSON.stringify(keys)).toBe(false);
    }
  });
});
