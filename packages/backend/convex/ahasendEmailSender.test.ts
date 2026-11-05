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

  it("strips CR/LF from display names (header-injection guard)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock).send({ ...MESSAGE, fromName: "Evil\r\nBcc: x" });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.from.name).toBe("Evil Bcc: x");
  });

  it("sends no recipient name for an empty toName", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock).send({ ...MESSAGE, toName: "" });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.recipients).toEqual([{ email: "anna@example.com" }]);
  });

  it("prefers the message's fromName over the configured default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock).send({
      ...MESSAGE,
      fromName: "Sander Verkuil | JigSwap",
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.from).toEqual({
      email: "notifications@jigswap.site",
      name: "Sander Verkuil | JigSwap",
    });
  });

  it("sends no custom headers without an unsubscribe URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await sender(fetchMock).send(MESSAGE);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.headers).toBeUndefined();
  });

  it("adds the RFC 8058 one-click unsubscribe headers when given a URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    const url = "https://x.convex.site/email/unsubscribe?token=v1.u.t.sig";
    await sender(fetchMock).send({ ...MESSAGE, listUnsubscribeUrl: url });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.headers).toEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("propagates a network-level fetch rejection", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(sender(fetchMock).send(MESSAGE)).rejects.toThrow("boom");
  });

  it("throws with the status only on a non-2xx, never the response body", async () => {
    // A provider error body may echo the recipient (SEC-75); the thrown message is logged.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "recipient anna@example.com (Anna) is suppressed",
        }),
        { status: 403 },
      ),
    );
    const error: unknown = await sender(fetchMock)
      .send(MESSAGE)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("AhaSend 403");
  });
});

describe("makeEmailSenderFromEnv", () => {
  it("returns the no-op when AhaSend env vars are missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noop = makeEmailSenderFromEnv({});
    await noop.send({ ...MESSAGE, subject: "Mara Display sent you a message" });
    expect(warn).toHaveBeenCalledTimes(1);
    // The drop is diagnosable by its key, but names no recipient and no subject (subjects
    // carry member names).
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("n-1");
    expect(logged).not.toContain("anna@example.com");
    expect(logged).not.toContain("Mara Display");
    warn.mockRestore();
  });

  it("returns the AhaSend adapter when fully configured", () => {
    const configured = makeEmailSenderFromEnv({
      AHASEND_API_KEY: "aha-sk-test",
      AHASEND_ACCOUNT_ID: "acc-1",
    });
    expect(configured).not.toBeNull();
    expect(typeof configured.send).toBe("function");
  });

  it("defaults: no-reply from address and sandbox ON unless explicitly disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await makeEmailSenderFromEnv(
      { AHASEND_API_KEY: "aha-sk-test", AHASEND_ACCOUNT_ID: "acc-1" },
      fetchMock,
    ).send(MESSAGE);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.from).toEqual({
      email: "no-reply@jigswap.site",
      name: "JigSwap",
    });
    expect(body.sandbox).toBe(true);
  });

  it("production disables sandbox with AHASEND_SANDBOX=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    await makeEmailSenderFromEnv(
      {
        AHASEND_API_KEY: "aha-sk-test",
        AHASEND_ACCOUNT_ID: "acc-1",
        AHASEND_SANDBOX: "false",
      },
      fetchMock,
    ).send(MESSAGE);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.sandbox).toBeUndefined();
  });
});
