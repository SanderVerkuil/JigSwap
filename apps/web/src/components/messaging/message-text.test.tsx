// @vitest-environment happy-dom
import { stripFormatting } from "@jigswap/contracts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageText } from "./message-text";

afterEach(cleanup);

const renderBody = (body: string) => {
  const { container } = render(
    <div data-testid="bubble">
      <MessageText body={body} />
    </div>,
  );
  return container.firstElementChild as HTMLElement;
};

describe("MessageText", () => {
  it("renders a plain message as one text node equal to the body", () => {
    const body = "Hi Mara,\n  see you at 3 (2*3*4 pieces) snake_case ~ ok";
    const bubble = renderBody(body);
    expect(bubble.childNodes).toHaveLength(1);
    expect(bubble.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(bubble.textContent).toBe(body);
  });

  it("renders each style as its semantic element", () => {
    const bubble = renderBody("**b** *i* __u__ ~~s~~ `c`");
    expect(bubble.querySelector("strong")?.textContent).toBe("b");
    expect(bubble.querySelector("em")?.textContent).toBe("i");
    expect(bubble.querySelector("u")?.textContent).toBe("u");
    expect(bubble.querySelector("s")?.textContent).toBe("s");
    expect(bubble.querySelector("code")?.textContent).toBe("c");
  });

  it("nests elements", () => {
    const bubble = renderBody("***both***");
    expect(bubble.querySelector("strong > em")?.textContent).toBe("both");
  });

  it("renders a link that opens safely in a new tab", () => {
    const bubble = renderBody("see https://x.nl/a_b.");
    const a = bubble.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://x.nl/a_b");
    expect(a?.textContent).toBe("https://x.nl/a_b");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");
  });

  it("never interprets HTML or dangerous schemes", () => {
    const body =
      "<img src=x onerror=alert(1)> <script>alert(1)</script> javascript:alert(1) data:text/html,x &amp;";
    const bubble = renderBody(body);
    expect(bubble.querySelector("img, script, a")).toBeNull();
    expect(bubble.textContent).toBe(body);
  });

  it("shows the same text as stripFormatting", () => {
    const body = "**a *b** c* \\*x\\* `y` www.x.nl!\nline";
    expect(renderBody(body).textContent).toBe(stripFormatting(body));
  });
});
