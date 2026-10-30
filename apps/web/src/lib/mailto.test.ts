import { describe, expect, it } from "vitest";
import { mailtoHref } from "./mailto";

// What a mail client reads from the link: the single recipient (percent-decoded path) and any
// header fields (the query).
const parsed = (href: string) => {
  const url = new URL(href);
  return {
    protocol: url.protocol,
    to: decodeURIComponent(url.pathname),
    headers: url.search,
    fragment: url.hash,
  };
};

describe("mailtoHref", () => {
  it("leaves an ordinary address readable", () => {
    expect(mailtoHref("anna@example.com")).toBe("mailto:anna@example.com");
    expect(mailtoHref("Mara.de-Vries@Example.co.uk")).toBe(
      "mailto:Mara.de-Vries@Example.co.uk",
    );
  });

  it("keeps URL syntax in the local part inside the address (IDENT-7)", () => {
    const address = "a?bcc=x%40evil.com@site.nl";
    const href = mailtoHref(address);
    expect(href).toBe("mailto:a%3Fbcc%3Dx%2540evil.com@site.nl");
    expect(parsed(href)).toEqual({
      protocol: "mailto:",
      to: address,
      headers: "",
      fragment: "",
    });
  });

  it.each([
    "x@site.nl?bcc=victim%40evil.com",
    "a&cc=v@site.nl",
    "a#frag@site.nl",
    "a+tag@site.nl",
    "a/b=c@site.nl",
  ])("never adds a header or fragment for %j", (address) => {
    expect(parsed(mailtoHref(address))).toEqual({
      protocol: "mailto:",
      to: address,
      headers: "",
      fragment: "",
    });
  });

  it("keeps a stray @ in the local part encoded, so the link has one recipient", () => {
    expect(mailtoHref("a@b@site.nl")).toBe("mailto:a%40b@site.nl");
  });

  it("encodes a value without an @ as a whole", () => {
    expect(mailtoHref("not an address?x=1")).toBe(
      "mailto:not%20an%20address%3Fx%3D1",
    );
  });
});
