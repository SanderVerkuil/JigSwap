import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { FindPeople } from "./find-people";

// Per-query data, keyed by the gateway function the component asks for.
const data = vi.hoisted(() => ({
  recent: [] as Array<{ _id: string }>,
}));

vi.mock("@/gateway", () => ({
  gateway: {
    identity: {
      search: "search",
      recentPublicMembers: "recent",
      currentUser: "me",
    },
  },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: string) => ({ ref }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ ref }: { ref: string }) => ({
    data:
      ref === "recent"
        ? data.recent
        : ref === "me"
          ? { _id: "me", name: "Mara", username: "mara" }
          : undefined,
  }),
}));
// The QR trigger is a marker: the test counts where it renders, not what it does.
vi.mock("@/components/social/qr-dialog", () => ({
  QrDialog: () => <button type="button">qr-trigger</button>,
}));
vi.mock("@/components/social/member-tile", () => ({
  MemberTile: () => <article>tile</article>,
  MemberTileSkeleton: () => null,
}));

const render = (locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <FindPeople />
    </IntlProvider>,
  );

const qrCount = (html: string) => html.split("qr-trigger").length - 1;

afterEach(() => {
  data.recent = [];
});

describe("FindPeople", () => {
  it("leaves the search row to the search box (the page head carries Show my QR)", () => {
    data.recent = [{ _id: "m1" }];
    const html = render();
    expect(html).toContain("tile");
    expect(qrCount(html)).toBe(0);
  });

  it("offers Show my QR once, in the empty state, with copy that matches it", () => {
    const html = render();
    expect(qrCount(html)).toBe(1);
    expect(html).toContain(en.people.find.recentlyJoinedEmptySub);
    // The button shows the member's own QR: the copy must not ask them to scan someone else's.
    expect(en.people.find.recentlyJoinedEmptySub).toMatch(/your QR/);
    expect(en.people.find.noResultsSub).toMatch(/your QR/);
    expect(en.people.find.noResultsSub).not.toMatch(/their QR/);
    expect(nl.people.find.noResultsSub).toMatch(/je QR-code/);
    expect(nl.people.find.noResultsSub).not.toMatch(/hun QR/);
  });
});
