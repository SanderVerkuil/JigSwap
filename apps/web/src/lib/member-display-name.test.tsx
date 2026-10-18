import { MemberInitial } from "@/components/members/member-initial";
import type { ExchangePartyState, MemberNameSource } from "@jigswap/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import nl from "../../locales/nl.json";
import {
  useMemberDisplayName,
  usePartyDisplayName,
  useProjectedMemberName,
} from "./member-display-name";

function Name({ source }: { source: MemberNameSource | null }) {
  const displayName = useMemberDisplayName();
  return <>{displayName(source)}</>;
}

const render = (node: React.ReactNode, locale: "en" | "nl" = "en") =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      {node}
    </IntlProvider>,
  );

describe("useMemberDisplayName", () => {
  it("renders the full name when present", () => {
    expect(
      render(<Name source={{ name: "Mara Jansen", username: "mara" }} />),
    ).toBe("Mara Jansen");
  });

  it('never renders "null null": falls back to email, then username', () => {
    expect(
      render(
        <Name
          source={{
            name: "null null",
            email: "me@example.com",
            username: "mara",
          }}
        />,
      ),
    ).toBe("me@example.com");
    expect(
      render(<Name source={{ name: "null null", username: "mara" }} />),
    ).toBe("mara");
  });

  it("falls back to the localized generic label", () => {
    expect(render(<Name source={{ name: "null null" }} />)).toBe("Puzzler");
    expect(render(<Name source={null} />, "nl")).toBe("Puzzelaar");
  });
});

function PartyName({
  source,
  state,
}: {
  source: MemberNameSource | null;
  state: ExchangePartyState;
}) {
  const partyName = usePartyDisplayName();
  return <>{partyName(source, state)}</>;
}

describe("usePartyDisplayName", () => {
  it("names a departed party 'Former member' and a hidden one generically", () => {
    expect(render(<PartyName source={null} state="departed" />)).toBe(
      "Former member",
    );
    expect(render(<PartyName source={null} state="departed" />, "nl")).toBe(
      "Voormalig lid",
    );
    expect(render(<PartyName source={null} state="hidden" />)).toBe("Puzzler");
    expect(
      render(<PartyName source={{ name: "Mara" }} state="tradeRevealed" />),
    ).toBe("Mara");
  });
});

type Projected = Parameters<ReturnType<typeof useProjectedMemberName>>[0];

function ProjectedName({ member }: { member: Projected }) {
  const projectedName = useProjectedMemberName();
  return <>{projectedName(member, "Anonymous user")}</>;
}

describe("useProjectedMemberName", () => {
  it("renders a revealed member's display name", () => {
    expect(
      render(
        <ProjectedName
          member={{ anonymous: false, member: { name: "Mara Jansen" } }}
        />,
      ),
    ).toBe("Mara Jansen");
  });

  it("renders the caller's anonymous label for a hidden member", () => {
    expect(render(<ProjectedName member={{ anonymous: true }} />)).toBe(
      "Anonymous user",
    );
  });

  it('renders "Former member" for a departed account', () => {
    expect(
      render(<ProjectedName member={{ anonymous: true, departed: true }} />),
    ).toBe("Former member");
    expect(
      render(
        <ProjectedName member={{ anonymous: true, departed: true }} />,
        "nl",
      ),
    ).toBe("Voormalig lid");
  });
});

describe("MemberInitial", () => {
  it("uses the initial of the resolved source", () => {
    expect(render(<MemberInitial source={{ name: "mara jansen" }} />)).toBe(
      "M",
    );
    expect(
      render(<MemberInitial source={{ name: "null null", username: "jan" }} />),
    ).toBe("J");
  });

  it('renders a person icon instead of "N" for a nameless member', () => {
    const html = render(<MemberInitial source={{ name: "null null" }} />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("N<");
  });
});
