// @vitest-environment happy-dom
import { UploadRateLimitedError } from "@/lib/upload-rate-limit";
import { renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import { useUploadLimitMessage } from "./use-upload-limit-message";

const refused = (data: Record<string, string | number>) =>
  new UploadRateLimitedError(new ConvexError(data));

const messageFor = (error: unknown, locale: "en" | "nl" = "en") => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {children}
    </IntlProvider>
  );
  return renderHook(() => useUploadLimitMessage(), { wrapper }).result.current(
    error,
  );
};

describe("useUploadLimitMessage", () => {
  it("says when the member can upload again, never a vague later", () => {
    const message = messageFor(
      refused({ code: "RateLimited", retryAfterMs: 3 * 3_600_000 }),
    );
    expect(message).toBe(
      "You've uploaded the most photos allowed for now. Try again in 3 hours.",
    );
  });

  it("speaks Dutch", () => {
    const message = messageFor(
      refused({ code: "RateLimited", retryAfterMs: 3 * 3_600_000 }),
      "nl",
    );
    expect(message).toBe(
      "Je hebt voorlopig het maximale aantal foto's geüpload. Probeer het over 3 uur opnieuw.",
    );
  });

  it("keeps the wording without a time for a refusal that doesn't say how long", () => {
    expect(messageFor(refused({ code: "RateLimited" }))).toBe(
      en.common.photoUploadRateLimited,
    );
  });
});
