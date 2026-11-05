import { describe, expect, it } from "vitest";
import {
  checkCopyImageText,
  MAX_COPY_IMAGE_DESCRIPTION_LENGTH,
  MAX_COPY_IMAGE_TITLE_LENGTH,
} from "./copy-image";

describe("checkCopyImageText", () => {
  it.each([
    ["title", { title: "x".repeat(MAX_COPY_IMAGE_TITLE_LENGTH + 1) }],
    [
      "description",
      { description: "x".repeat(MAX_COPY_IMAGE_DESCRIPTION_LENGTH + 1) },
    ],
  ])("refuses an over-long %s with ImageTextTooLong", (_field, text) => {
    const refused = checkCopyImageText(text);

    expect(refused.isErr).toBe(true);
    if (refused.isErr) expect(refused.error.code).toBe("ImageTextTooLong");
  });

  it("takes a title and a description at exactly their limits", () => {
    const outcome = checkCopyImageText({
      title: "x".repeat(MAX_COPY_IMAGE_TITLE_LENGTH),
      description: "x".repeat(MAX_COPY_IMAGE_DESCRIPTION_LENGTH),
    });

    expect(outcome.isOk).toBe(true);
  });

  it("takes a photo with no text", () => {
    expect(checkCopyImageText({}).isOk).toBe(true);
  });
});
