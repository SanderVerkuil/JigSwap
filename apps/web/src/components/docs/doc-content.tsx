export function DocContent({ html }: { html: string }) {
  return (
    <div className="docs-prose" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
