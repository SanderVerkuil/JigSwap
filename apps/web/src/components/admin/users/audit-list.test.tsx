// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import nl from "../../../../locales/nl.json";
import { AuditList } from "./audit-list";

const NOW = new Date("2026-10-30T12:00:00Z");

afterEach(cleanup);

describe("AuditList", () => {
  it("names a member whose account is gone with a localized in-sentence 'a deleted member' (SEC-57)", () => {
    render(
      <IntlProvider
        locale="nl"
        messages={nl}
        timeZone="Europe/Amsterdam"
        now={NOW}
      >
        <AuditList
          emptyLabel="Nothing"
          entries={[
            {
              kind: "role_revoked",
              actorName: "Ada",
              targetLabel: "Deleted member",
              targetMemberDeleted: true,
              targetId: "deleted-member",
              at: NOW.getTime() - 60_000,
            },
          ]}
        />
      </IntlProvider>,
    );
    expect(screen.getByText(/beheerdersrol/).closest("p")?.textContent).toBe(
      "Ada trok de beheerdersrol van een verwijderd lid in",
    );
  });
});
