import type { NavLink } from "@/docs/types";
import { Link } from "@tanstack/react-router";

// A group's index page lists its articles after its own text, each with its summary as the line
// that says when to read it. It is built from the nav, so it lists what the sidebar lists and
// never drifts from the pages. Plain running text on the page ground, like the article prose.
export function DocGroupArticles({ links }: { links: NavLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="docs-prose">
      <ul>
        {links.map((link) => (
          <li key={link.slug}>
            <Link to="/docs/$" params={{ _splat: link.slug }}>
              {link.title}
            </Link>
            {link.summary && <p>{link.summary}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
