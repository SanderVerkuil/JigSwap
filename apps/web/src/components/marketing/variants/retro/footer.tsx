import { Link } from "@/compat/link";
import type { CommunityAvatar } from "@/components/marketing/variants/use-landing-data";
import { Wordmark } from "@/components/marketing/wordmark";
import { useTranslations } from "use-intl";
import { CommunityChips } from "./avatars";
import { Barcode } from "./barcode";
import { LangToggle, ModeToggle } from "./chrome";

// Retro footer — the box BOTTOM: CSS barcode + colophon left, nav columns +
// toggles + contributors right. Keeps the <footer> landmark, all nav routes,
// and both toggles.
export function RetroFooter({
  avatars,
}: {
  avatars: CommunityAvatar[] | undefined;
}) {
  const t = useTranslations("marketing.nav");
  const year = new Date().getFullYear();

  return (
    <footer className="paper v-double-rule border-mk-border border-t-2">
      <div className="mx-auto w-full max-w-[1200px] px-6 pt-16 pb-10">
        <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-12 max-[860px]:grid-cols-2 max-[860px]:gap-8 max-[540px]:grid-cols-1">
          {/* Colophon */}
          <div className="max-[540px]:order-1">
            <Wordmark />
            <Barcode className="mt-5" />
            <p className="text-mk-text-muted mt-4 font-mono text-[11.5px] leading-relaxed font-semibold tracking-[0.1em] uppercase">
              JIGSWAP · NL · MMXXV
              <br />
              Printed at a kitchen table
              <br />1 Shelf · Many Hands
            </p>
          </div>

          {/* Nav columns */}
          <FooterCol
            title={t("howItWorks")}
            links={[
              { href: "/how-it-works", label: t("howItWorks") },
              { href: "/features", label: t("features") },
              { href: "/docs", label: t("docs") },
              { href: "/sign-up", label: t("startTrading") },
            ]}
          />
          <div className="flex flex-col gap-3">
            <FooterCol
              title={t("about")}
              links={[
                { href: "/about", label: t("about") },
                { href: "/contact", label: t("contact") },
                { href: "/privacy", label: "Privacy" },
                { href: "/terms", label: "Terms" },
              ]}
            />
            <div className="mt-4 flex items-center gap-2.5">
              <LangToggle />
              <ModeToggle />
            </div>
          </div>
        </div>

        {/* Contributors + sign-off */}
        <div className="border-mk-border mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <span className="text-mk-text-muted font-mono text-[12px] tracking-[0.08em] uppercase">
            © {year} JigSwap · Made at a Dutch kitchen table
          </span>
          <div className="flex items-center gap-3">
            <CommunityChips avatars={avatars} size={32} />
            <span className="text-mk-text-muted font-mono text-[11px] font-semibold tracking-[0.12em] uppercase">
              Made with fellow puzzlers
            </span>
          </div>
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
  links: { href: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mk-heading text-mk-text-strong text-sm font-bold tracking-wide uppercase">
        {title}
      </div>
      {links.map((lk) => (
        <Link
          key={lk.href + lk.label}
          href={lk.href}
          className="text-mk-text-body hover:text-mk-violet-600 focus-visible:ring-mk-ring w-fit rounded-[4px] text-[14.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {lk.label}
        </Link>
      ))}
    </div>
  );
}
