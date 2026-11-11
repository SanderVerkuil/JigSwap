import { isPlainClick } from "@/hooks/use-active-heading";
import { useRouter } from "@tanstack/react-router";

// A docs URL in the rendered markdown: /docs, a page under it, or either with a hash.
const DOCS_HREF = /^\/docs(?:[/?#]|$)/;

// The article's links to other docs pages are plain <a> tags in the markdown. A plain click on one
// goes through the router, like the sidebar's links, instead of reloading the page (which also
// reset the sidebar); the router lands a hash below the sticky header. Clicks with a modifier,
// links that open in a new tab and links outside the docs keep the browser's own behaviour.
export function DocContent({ html }: { html: string }) {
  const router = useRouter();
  return (
    <div
      className="docs-prose"
      onClick={(e) => {
        if (e.defaultPrevented || !isPlainClick(e)) return;
        if (!(e.target instanceof Element)) return;
        const link = e.target.closest("a[href]");
        if (!link || (link.getAttribute("target") ?? "_self") !== "_self") {
          return;
        }
        const href = link.getAttribute("href") ?? "";
        if (!DOCS_HREF.test(href)) return;
        e.preventDefault();
        void router.navigate({ href });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
