import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, EMAIL_COPY, EMAIL_TYPES, FOOTER } from "./copy";

describe("copy catalog", () => {
  it("pins the copy catalog verbatim (mutation guard + copy change review gate)", () => {
    expect({
      EMAIL_TYPES,
      DEFAULT_PARAMS,
      FOOTER,
      EMAIL_COPY,
    }).toMatchSnapshot();
  });
});
