import type { CommunityAvatar } from "@/components/marketing/variants/use-landing-data";

const AVATAR_COLORS = [
  "var(--mk-violet-400)",
  "var(--mk-green-500)",
  "var(--mk-pink-400)",
  "var(--mk-violet-600)",
] as const;

// Decorative fallback members shown while the community query is loading or
// empty. Not real people — purely visual placeholders (aria-hidden anyway).
const FALLBACK: Array<[string, string]> = [
  ["MI", "var(--mk-violet-400)"],
  ["TK", "var(--mk-green-500)"],
  ["LV", "var(--mk-pink-400)"],
  ["RJ", "var(--mk-violet-600)"],
];

// Overlapping circular avatar cluster. Fully decorative (aria-hidden) — the
// meaning lives in the adjacent live-count text.
export function AvatarCluster({
  avatars,
  size = 38,
}: {
  avatars: CommunityAvatar[] | undefined;
  size?: number;
}) {
  const hasLive = avatars != null && avatars.length >= 1;
  const items = hasLive ? avatars : FALLBACK;
  return (
    <div aria-hidden="true" className="flex">
      {items.map((item, i) => {
        const overlap = i ? -Math.round(size * 0.29) : 0;
        if (hasLive) {
          const member = item as CommunityAvatar;
          return member.image != null ? (
            <span
              key={i}
              className="rounded-full inline-flex items-center justify-center border-2 border-mk-card overflow-hidden bg-mk-muted"
              style={{ width: size, height: size, marginLeft: overlap }}
            >
              <img
                src={member.image}
                alt=""
                className="w-full h-full rounded-full object-cover"
              />
            </span>
          ) : (
            <span
              key={i}
              className="rounded-full text-white font-mk-heading font-semibold inline-flex items-center justify-center border-2 border-mk-card"
              style={{
                width: size,
                height: size,
                marginLeft: overlap,
                fontSize: Math.round(size * 0.34),
                background: AVATAR_COLORS[i % AVATAR_COLORS.length],
              }}
            >
              {member.initials}
            </span>
          );
        }
        const [txt, bg] = item as [string, string];
        return (
          <span
            key={txt}
            className="rounded-full text-white font-mk-heading font-semibold inline-flex items-center justify-center border-2 border-mk-card"
            style={{
              width: size,
              height: size,
              marginLeft: overlap,
              fontSize: Math.round(size * 0.34),
              background: bg,
            }}
          >
            {txt}
          </span>
        );
      })}
    </div>
  );
}
