// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ProfileCompletionsSection } from "./profile-listings";

// A finished solve's photos on a profile: each 44px tile takes its small rendition when the photo
// has one, and the link around it opens the original.

const PHOTO_SRC_SET =
  "https://files.test/one-small.webp 256w, https://files.test/one.jpg 1600w";

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({
    results: [
      {
        _id: "c1",
        title: "Tirol",
        startDate: Date.UTC(2026, 9, 28),
        endDate: Date.UTC(2026, 9, 29),
        datePrecision: "day",
        photoUrls: ["https://files.test/one.jpg", "https://files.test/two.jpg"],
        photoSrcSets: [PHOTO_SRC_SET, null],
        pendingPhotos: [],
      },
    ],
    status: "Exhausted",
    loadMore: () => {},
  }),
}));

afterEach(() => cleanup());

describe("ProfileCompletionsSection photos", () => {
  it("lets a tile pick its rendition, and links the original", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ProfileCompletionsSection
          memberId={"member1" as never}
          firstName="Hans"
        />
      </IntlProvider>,
    );
    const [first, second] = screen.getAllByRole("link", { name: "Tirol" });
    expect(first.getAttribute("href")).toBe("https://files.test/one.jpg");
    const firstTile = first.querySelector("img")!;
    expect(firstTile.getAttribute("srcset")).toBe(PHOTO_SRC_SET);
    expect(firstTile.getAttribute("sizes")).toBe("44px");
    const secondTile = second.querySelector("img")!;
    expect(secondTile.getAttribute("src")).toBe("https://files.test/two.jpg");
    expect(secondTile.getAttribute("srcset")).toBeNull();
    expect(secondTile.getAttribute("sizes")).toBeNull();
  });
});
