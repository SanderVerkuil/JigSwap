import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SUBJECT,
  isGoneStatus,
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
      { title: "t", body: "b", type: "x", url: "/notifications" },
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
    });
  });
});
