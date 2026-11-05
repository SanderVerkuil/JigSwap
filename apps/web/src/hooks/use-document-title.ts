import { useEffect } from "react";

/**
 * The tab title a page can only know once its data has loaded (a puzzle's or a member's name).
 * head() runs outside React and before the data, so the route keeps its static title until then.
 * On leaving, the static title comes back unless the next route already wrote its own: two routes
 * with the same static title don't write it again, and this page's cleanup runs after that commit.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const routeTitle = document.title;
    document.title = title;
    return () => {
      if (document.title === title) document.title = routeTitle;
    };
  }, [title]);
}
