import { Link } from "@/compat/link";
import { ChevronRight } from "lucide-react";

export function DocBreadcrumb({
  trail,
}: {
  trail: { title: string; to?: string }[];
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-[13px] text-mk-text-muted mb-4"
    >
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {c.to ? (
            <Link href={c.to} className="hover:text-mk-violet-600">
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
