import { Container } from "@/components/marketing/container";
import { Section } from "@/components/marketing/section";
import type {
  CommunityAvatar,
  LandingStats,
} from "@/components/marketing/variants/use-landing-data";

const AVATAR_COLORS = [
  "var(--mk-violet-400)",
  "var(--mk-green-500)",
  "var(--mk-pink-400)",
  "var(--mk-violet-600)",
] as const;

// Small warm overlapping avatar cluster (decorative — meaning is in the text).
function AvatarCluster({ avatars }: { avatars: CommunityAvatar[] }) {
  return (
    <div aria-hidden="true" className="flex justify-center">
      {avatars.map((member, i) =>
        member.image != null ? (
          <span
            key={i}
            className="border-mk-card ring-mk-border inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 ring-1"
            style={{ marginLeft: i ? -8 : 0 }}
          >
            <img
              src={member.image}
              alt=""
              className="h-full w-full rounded-full object-cover"
            />
          </span>
        ) : (
          <span
            key={i}
            className="font-mk-heading border-mk-card inline-flex h-9 w-9 items-center justify-center rounded-full border-2 text-[12px] font-semibold text-white"
            style={{
              background: AVATAR_COLORS[i % AVATAR_COLORS.length],
              marginLeft: i ? -8 : 0,
            }}
          >
            {member.initials}
          </span>
        ),
      )}
    </div>
  );
}

// Section 2 — warm "moment" strip. Humanizes the live user count into one warm
// sentence sitting on warm sand, with a small real-avatar cluster. While stats
// load we render a skeleton sentence and never announce 0.
export function MomentStrip({
  stats,
  avatars,
}: {
  stats: LandingStats | undefined;
  avatars: CommunityAvatar[] | undefined;
}) {
  const hasAvatars = avatars != null && avatars.length >= 1;

  return (
    <Section tint>
      <Container>
        <div className="mx-auto flex max-w-[760px] flex-col items-center gap-5 text-center">
          {hasAvatars && <AvatarCluster avatars={avatars} />}

          {stats === undefined ? (
            <p className="font-mk-heading text-mk-text-muted text-[clamp(22px,3.4vw,30px)] leading-snug font-semibold">
              Pull up a chair…
            </p>
          ) : (
            <h2 className="font-mk-heading text-mk-text-strong text-[clamp(22px,3.4vw,30px)] leading-snug font-semibold tracking-tight">
              <span className="text-mk-violet-600">
                {stats.totalUsers.toLocaleString()}
              </span>{" "}
              puzzlers gathered round the table.
            </h2>
          )}

          <p className="text-mk-text-body max-w-[52ch] text-[clamp(15px,1.6vw,17px)] leading-relaxed text-pretty">
            Not a crowd — a community. Real people shelving, lending, and
            passing their puzzles on.
          </p>
        </div>
      </Container>
    </Section>
  );
}
