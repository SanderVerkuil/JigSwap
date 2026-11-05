import { Link } from "@/compat/link";
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
      // Wraps between crumbs, so each keeps its text on one line unless that alone is too wide.
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[14px] text-mk-text-muted mb-4"
    >
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5 whitespace-nowrap">
          {c.to ? (
            <Link href={c.to} className="hover:text-mk-text-strong">
              {c.title}
            </Link>
          ) : (
            <span className="text-mk-text-body font-medium" aria-current="page">
              {c.title}
            </span>
          )}
          {i < trail.length - 1 && (
            <ChevronRight className="size-3.5 opacity-50" />
          )}
        </span>
      ))}
    </nav>
  );
}
