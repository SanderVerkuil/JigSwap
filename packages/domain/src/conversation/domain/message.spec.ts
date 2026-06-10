import { describe, expect, it } from "vitest";
import { toMemberId, toMessageId } from "../../shared-kernel";
import { Message, MessageState } from "./message";

const state: MessageState = {
  id: toMessageId("msg-1"),
  authorId: toMemberId("alice"),
  kind: "text",
  body: "Hello there",
  sentAt: new Date("2026-06-08T10:00:00Z"),
};

describe("Message", () => {
  it("exposes its state through getters and round-trips via fromState/toState", () => {
    const msg = Message.fromState(state);
    expect(msg.id).toBe(state.id);
    expect(msg.authorId).toBe(state.authorId);
    expect(msg.kind).toBe("text");
    expect(msg.body).toBe("Hello there");
    expect(msg.sentAt).toBe(state.sentAt);
    expect(msg.toState()).toEqual(state);
  });
});
