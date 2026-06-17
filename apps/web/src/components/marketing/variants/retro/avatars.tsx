import type { CommunityAvatar } from "@/components/marketing/variants/use-landing-data";
import { cn } from "@/lib/utils";

// Decorative overlapping member chips (real initials/photos from Convex, with a
// stable placeholder set while loading). aria-hidden — the live count line and
// copy carry the meaning.
const PLACEHOLDER = ["AvB", "MK", "JdW", "St"];

export function CommunityChips({
  avatars,
  size = 38,
  className,
}: {
  avatars: CommunityAvatar[] | undefined;
  size?: number;
  className?: string;
}) {
  const loading = avatars === undefined;
  const items =
    avatars && avatars.length > 0
      ? avatars
      : PLACEHOLDER.map((initials) => ({ initials, image: null }));

  return (
    <div aria-hidden="true" className={cn("flex items-center", className)}>
      {items.slice(0, 4).map((a, i) => (
        <span
          key={i}
          className={cn(
            "border-mk-card bg-mk-muted text-mk-text-strong relative inline-flex items-center justify-center overflow-hidden rounded-full border-2 font-mono text-[11px] font-bold",
            loading && "animate-pulse",
          )}
          style={{
            width: size,
            height: size,
            marginLeft: i === 0 ? 0 : -size * 0.32,
            zIndex: items.length - i,
          }}
        >
          {a.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={a.image}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            a.initials
          )}
        </span>
      ))}
    </div>
  );
}
