import { describe, expect, it, vi } from "vitest";
import { ahaSendEmailSender } from "./notifications/adapters/ahasendEmailSender";
import { makeEmailSenderFromEnv } from "./notifications/adapters/email";

const MESSAGE = {
  to: "anna@example.com",
  toName: "Anna",
  subject: "New trade request on JigSwap",
  html: "<p>hi</p>",
  text: "hi",
  idempotencyKey: "n-1",
};

const okResponse = () =>
  new Response(JSON.stringify({ object: "list", data: [] }), { status: 202 });

const sender = (fetchMock: typeof fetch, sandbox = false) =>
  ahaSendEmailSender({
    apiKey: "aha-sk-test",
    accountId: "acc-1",
    from: "notifications@jigswap.site",
    fromName: "JigSwap",
    sandbox,
    fetchImpl: fetchMock,
  });

describe("ahaSendEmailSender", () => {
  it("POSTs the AhaSend v2 message shape with auth and idempotency headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock).send(MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.ahasend.com/v2/accounts/acc-1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer aha-sk-test");
    expect(headers["Idempotency-Key"]).toBe("n-1");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: { email: "notifications@jigswap.site", name: "JigSwap" },
      recipients: [{ email: "anna@example.com", name: "Anna" }],
      subject: "New trade request on JigSwap",
      html_content: "<p>hi</p>",
      text_content: "hi",
    });
  });

  it("adds sandbox: true when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock, true).send(MESSAGE);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.sandbox).toBe(true);
  });

  it("strips CR/LF from the subject (header-injection guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock).send({
      ...MESSAGE,
      subject: "Hi\r\nBcc: evil@example.com\nX: y",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.subject).toBe("Hi Bcc: evil@example.com X: y");
  });

  it("propagates a network-level fetch rejection", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(sender(fetchMock).send(MESSAGE)).rejects.toThrow("boom");
  });

  it("throws with status and response text on a non-2xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("unverified domain", { status: 403 }));
    await expect(sender(fetchMock).send(MESSAGE)).rejects.toThrow(
      /AhaSend 403.*unverified domain/,
    );
  });
});

describe("makeEmailSenderFromEnv", () => {
  it("returns the no-op when AhaSend env vars are missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noop = makeEmailSenderFromEnv({});
    await noop.send(MESSAGE); // must not throw
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns the AhaSend adapter when fully configured", () => {
    const configured = makeEmailSenderFromEnv({
      AHASEND_API_KEY: "aha-sk-test",
      AHASEND_ACCOUNT_ID: "acc-1",
      EMAIL_FROM: "notifications@jigswap.site",
    });
    expect(configured).not.toBeNull();
    expect(typeof configured.send).toBe("function");
  });
});
