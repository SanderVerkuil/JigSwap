import { Link } from "@/compat/link";
import type { LandingData } from "@/components/marketing/variants/use-landing-data";
import { Wordmark } from "@/components/marketing/wordmark";

// Editorial footer / colophon (rebuilt from MarketingFooter). Publication
// credits: a top hairline rule echo, the wordmark + positioning + issue line,
// nav columns, and a live "Contributors" avatars row. Keeps the <footer>
// landmark and the same nav destinations; re-skins via --mk-* under .v-editorial.

const PRODUCT = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/features", label: "Features" },
  { href: "/docs", label: "Docs" },
  { href: "/sign-up", label: "Get on the shelf" },
] as const;

const LEGAL = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

const AVATAR_COLORS = [
  "var(--mk-violet-400)",
  "var(--mk-green-500)",
  "var(--mk-pink-400)",
  "var(--mk-violet-600)",
] as const;

export function EditorialFooter({ data }: { data: LandingData }) {
  const avatars = data.communityAvatars;
  const hasLive = avatars != null && avatars.length >= 1;

  return (
    <footer className="border-t border-mk-border bg-mk-card">
      <div className="w-full max-w-[1200px] mx-auto px-6">
        {/* Masthead echo rule */}
        <div className="h-[34px] flex items-center justify-between border-b border-mk-border ed-mono text-[11px] tracking-[0.18em] uppercase text-mk-text-muted">
          <span>JigSwap</span>
          <span className="max-[540px]:hidden">Colophon</span>
          <span>2025</span>
        </div>

        <div className="grid gap-10 py-[clamp(40px,6vw,72px)] min-[861px]:[grid-template-columns:2fr_1fr_1fr_1.5fr] max-[860px]:grid-cols-2 max-[540px]:grid-cols-1">
          {/* (1) Wordmark + positioning + issue line */}
          <div className="max-w-[340px]">
            <Wordmark />
            <p className="mt-4 text-[14.5px] leading-relaxed text-mk-text-body text-pretty">
              Puzzling, redrawn — a bold home for the people who love finishing
              them and passing them on.
            </p>
            <p className="mt-5 ed-mono text-[11px] tracking-[0.14em] uppercase text-mk-text-muted">
              Issue 01 · Est. 2025 · Made in the Netherlands
            </p>
          </div>

          {/* (2) Product nav */}
          <FooterCol title="Index" links={PRODUCT} />

          {/* (3) Legal / secondary */}
          <FooterCol title="More" links={LEGAL} />

          {/* (4) Contributors */}
          <div>
            <div className="ed-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-mk-text-muted">
              Contributors
            </div>
            <div className="mt-4 flex items-center" aria-hidden="true">
              {hasLive
                ? avatars.map((member, i) =>
                    member.image != null ? (
                      <span
                        key={i}
                        className="w-7 h-7 rounded-full inline-flex items-center justify-center border-2 border-mk-card overflow-hidden"
                        style={{ marginLeft: i ? -8 : 0 }}
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
                        className="w-7 h-7 rounded-full text-white font-mk-heading font-semibold text-[11px] inline-flex items-center justify-center border-2 border-mk-card"
                        style={{
                          background: AVATAR_COLORS[i % AVATAR_COLORS.length],
                          marginLeft: i ? -8 : 0,
                        }}
                      >
                        {member.initials}
                      </span>
                    ),
                  )
                : AVATAR_COLORS.map((bg, i) => (
                    <span
                      key={i}
                      className="w-7 h-7 rounded-full border-2 border-mk-card bg-mk-muted"
                      style={{ background: bg, marginLeft: i ? -8 : 0 }}
                    />
                  ))}
            </div>
            <p className="mt-3 text-[13px] text-mk-text-muted">
              The JigSwap community
            </p>
          </div>
        </div>

        <div className="py-6 border-t border-mk-border flex justify-between items-center flex-wrap gap-3">
          <span className="text-[13px] text-mk-text-muted">
            © {new Date().getFullYear()} JigSwap
          </span>
          <span className="ed-mono text-[11px] tracking-[0.16em] uppercase text-mk-text-muted">
            Netherlands
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="ed-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-mk-text-muted">
        {title}
      </div>
      {links.map((lk) => (
        <Link
          key={lk.href + lk.label}
          href={lk.href}
          className="text-[14.5px] text-mk-text-body transition-colors hover:text-mk-text-strong hover:underline underline-offset-4 decoration-[var(--v-accent)]"
        >
          {lk.label}
        </Link>
      ))}
    </div>
  );
}
