import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  EMAIL_COPY,
  EMAIL_TYPES,
  FOOTER,
  FORMER_MEMBER,
} from "./copy";

describe("copy catalog", () => {
  it("pins the copy catalog verbatim (mutation guard + copy change review gate)", () => {
    expect({
      EMAIL_TYPES,
      DEFAULT_PARAMS,
      FOOTER,
      FORMER_MEMBER,
      EMAIL_COPY,
    }).toMatchSnapshot();
  });
});
