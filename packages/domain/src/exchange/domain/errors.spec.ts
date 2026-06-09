import { describe, expect, it } from "vitest";
import { ExchangeError } from "./errors";

describe("ExchangeError factories", () => {
  it("selfExchange", () => {
    const e = ExchangeError.selfExchange();
    expect(e.code).toBe("SelfExchange");
    expect(e.name).toBe("ExchangeError");
    expect(e.message).toBe("Initiator and recipient must be different members");
  });

  it("missingTerms interpolates kind and detail", () => {
    const e = ExchangeError.missingTerms("sale", "a price is required");
    expect(e.code).toBe("MissingTerms");
    expect(e.message).toBe("Invalid terms for sale: a price is required");
  });

  it("illegalTransition names both states", () => {
    const e = ExchangeError.illegalTransition("proposed", "completed");
    expect(e.code).toBe("IllegalTransition");
    expect(e.message).toBe("Cannot transition from proposed to completed");
  });

  it("wrongParty interpolates the action", () => {
    const e = ExchangeError.wrongParty("accept");
    expect(e.code).toBe("WrongParty");
    expect(e.message).toBe("Acting member may not accept");
  });
});
