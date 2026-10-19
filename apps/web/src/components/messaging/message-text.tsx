import { parseMessageMarkup, type MarkupNode } from "@jigswap/contracts";
import { useMemo, type ReactNode } from "react";

// A member-authored message body with its formatting (bold, italic, underline,
// strike, inline code, links) rendered as semantic elements. Only React
// elements and text: the parser never produces HTML, and nothing here uses
// dangerouslySetInnerHTML. A body without markers renders as its plain text.

function renderNodes(nodes: MarkupNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return (
          <code
            key={index}
            className="rounded bg-black/10 px-1 font-mono text-[0.9em] dark:bg-white/15"
          >
            {node.value}
          </code>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="break-all underline"
          >
            {node.text}
          </a>
        );
      case "strong":
        return <strong key={index}>{renderNodes(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderNodes(node.children)}</em>;
      case "underline":
        return <u key={index}>{renderNodes(node.children)}</u>;
      case "strike":
        return <s key={index}>{renderNodes(node.children)}</s>;
    }
  });
}

export function MessageText({ body }: { body: string }) {
  const nodes = useMemo(() => parseMessageMarkup(body), [body]);
  return <>{renderNodes(nodes)}</>;
}
