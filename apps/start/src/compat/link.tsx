import { Link as RouterLink } from "@tanstack/react-router";
import * as React from "react";

// next/link compat: ported `next/link` usages just swap the import. Accepts a
// string `href` and renders TanStack Router's Link; external/absolute/anchor
// targets fall back to a plain <a> since the typed router can't route them.
type AnchorProps = Omit<React.ComponentPropsWithoutRef<"a">, "href">;

export interface LinkProps extends AnchorProps {
  href: string;
  // next/link extras accepted for source-compatibility, then ignored.
  replace?: boolean;
  prefetch?: boolean | null;
  scroll?: boolean;
  children?: React.ReactNode;
}

function isExternal(href: string): boolean {
  return /^([a-z]+:)?\/\//i.test(href) || /^(mailto:|tel:|#)/i.test(href);
}

export function Link({
  href,
  replace,
  children,
  // Accepted from the next/link API surface but not forwarded to the DOM.
  prefetch,
  scroll,
  ...rest
}: LinkProps) {
  void prefetch;
  void scroll;

  if (isExternal(href)) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink to={href} replace={replace} {...rest}>
      {children}
    </RouterLink>
  );
}

export default Link;
