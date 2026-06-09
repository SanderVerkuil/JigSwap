import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { CopyId, ExchangeId } from "../domain";
import { ApplicationError } from "./errors";

const copy = toId<"CopyId">("copy1") as CopyId;

describe("ApplicationError factories", () => {
  it("copyNotFound interpolates the copy id", () => {
    const e = ApplicationError.copyNotFound(copy);
    expect(e.code).toBe("CopyNotFound");
    expect(e.name).toBe("ApplicationError");
    expect(e.message).toBe("Copy copy1 could not be found");
  });

  it("copyNotAvailable interpolates copy id and kind", () => {
    const e = ApplicationError.copyNotAvailable(copy, "lend");
    expect(e.code).toBe("CopyNotAvailable");
    expect(e.message).toBe("Copy copy1 is not available for lend");
  });

  it("offeredCopyNotOwned interpolates the copy id", () => {
    const e = ApplicationError.offeredCopyNotOwned(copy);
    expect(e.code).toBe("OfferedCopyNotOwned");
    expect(e.message).toBe("Offered copy copy1 is not owned by the initiator");
  });

  it("duplicateProposal interpolates the copy id", () => {
    const e = ApplicationError.duplicateProposal(copy);
    expect(e.code).toBe("DuplicateProposal");
    expect(e.message).toBe("An active proposal already exists for copy copy1");
  });

  it("exchangeNotFound interpolates the exchange id", () => {
    const id = toId<"ExchangeId">("ex1") as ExchangeId;
    const e = ApplicationError.exchangeNotFound(id);
    expect(e.code).toBe("ExchangeNotFound");
    expect(e.message).toBe("Exchange ex1 could not be found");
  });
});
