import { Link } from "@/compat/link";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";

export function DocBreadcrumb({
  trail,
}: {
  trail: { title: string; to?: string }[];
}) {
  const t = useTranslations("marketing.docs");
  return (
    <nav
      aria-label={t("breadcrumbLabel")}
      // Wraps between crumbs, and the links keep their text on one line. The page's own title may
      // wrap too, where it alone is wider than the column (a long Dutch title on a phone). On touch
      // screens wrapped rows sit 24px apart, so the links' hit areas (12px above and below) meet
      // without one row's link covering the other's text.
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pointer-coarse:gap-y-6 text-[14px] text-mk-text-muted mb-4"
    >
      {trail.map((c, i) => {
        // Only the page itself is current; TanStack would also mark the links to its parents.
        const last = i === trail.length - 1;
        return (
          <span
            key={i}
            className={cn(
              "flex items-center gap-1.5",
              !last && "whitespace-nowrap",
            )}
          >
            {c.to ? (
              <Link
                href={c.to}
                activeOptions={{ exact: true }}
                // A 44px hit area on touch screens that doesn't push the title down.
                className="relative hover:text-mk-text-strong pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3"
              >
                {c.title}
              </Link>
            ) : last ? (
              <span
                className="text-mk-text-body font-medium"
                aria-current="page"
              >
                {c.title}
              </span>
            ) : (
              <span>{c.title}</span>
            )}
            {!last && <ChevronRight className="size-3.5 opacity-50" />}
          </span>
        );
      })}
    </nav>
  );
}
