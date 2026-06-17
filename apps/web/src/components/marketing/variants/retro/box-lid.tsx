import { Link } from "@/compat/link";
import { Reveal } from "@/components/marketing/reveal";
import type {
  CommunityAvatar,
  LandingStats,
} from "@/components/marketing/variants/use-landing-data";
import { Button } from "@/components/ui/button";
import { CommunityChips } from "./avatars";
import { CornerStamp } from "./corner-stamp";

// The hero: a flat, printed box LID. Warmth from layered print craft (offset
// ink, die-cut edge, paper grain, corner stamp), not 3D/heavy JS.
export function BoxLid({
  startHref,
  stats,
  avatars,
}: {
  startHref: string;
  stats: LandingStats | undefined;
  avatars: CommunityAvatar[] | undefined;
}) {
  const count = stats?.totalUsers;

  return (
    <section
      id="top"
      className="relative w-full overflow-x-clip py-[clamp(48px,7vw,88px)]"
      style={{ background: "var(--v-lid-ground)" }}
    >
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <Reveal>
          <div className="relative mx-auto max-w-[980px]">
            {/* Corner stamp — clipped inside the lid via the card overflow */}
            <div className="paper v-box v-lid-settle relative overflow-hidden border-[3px] border-[var(--mk-text-strong)] px-[clamp(20px,5vw,64px)] py-[clamp(36px,6vw,64px)]">
              <CornerStamp
                size={116}
                className="v-stamp-down pointer-events-none absolute -top-1 right-2 origin-center [transform:rotate(8deg)] max-[860px]:w-[clamp(56px,16vw,84px)]"
              />

              <div className="mx-auto max-w-[760px] text-center">
                {/* Spec banner */}
                <div
                  className="mb-6 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[var(--v-radius-chip)] px-4 py-2 font-mono text-[11px] font-bold tracking-[0.14em] uppercase"
                  style={{
                    background: "var(--v-band-teal)",
                    color: "#fbf3df",
                  }}
                >
                  <span>Ages 6–106</span>
                  <Dot />
                  <span>500–2000 Pieces</span>
                  <Dot />
                  <span>1 Shelf, Many Hands</span>
                </div>

                <p className="text-mk-text-muted mb-4 font-mono text-[11px] font-semibold tracking-[0.22em] uppercase">
                  The Puzzle Library · No. 2025
                </p>

                <h1 className="font-mk-heading v-offset-hero text-mk-text-strong text-[clamp(34px,7vw,76px)] leading-[1.02] font-extrabold tracking-tight text-balance">
                  A digital shelf for an analog joy.
                </h1>

                <p className="text-mk-text-body mx-auto mt-5 max-w-[58ch] text-[clamp(16px,2.2vw,19px)] leading-relaxed text-pretty">
                  Shelve every jigsaw, lend and swap with fellow puzzlers, and
                  always know which box is on whose table. Screen-free fun —
                  finally organised.
                </p>

                <div className="mt-7 flex flex-wrap items-center justify-center gap-3 max-[540px]:flex-col">
                  <Button
                    variant="brand"
                    size="lg"
                    className="h-12 px-7 text-[15px] max-[540px]:w-full"
                    asChild
                  >
                    <Link href={startHref}>Open the box</Link>
                  </Button>
                  <Button
                    size="lg"
                    className="bg-mk-card text-mk-text-strong border-mk-text-strong hover:bg-mk-muted focus-visible:ring-mk-ring h-12 border-2 px-7 text-[15px] font-semibold shadow-[var(--shadow-mk-sm)] transition-colors focus-visible:ring-2 focus-visible:outline-none max-[540px]:w-full"
                    asChild
                  >
                    <Link href="#contents">See what&apos;s inside</Link>
                  </Button>
                </div>

                {/* Live trust row */}
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                  <CommunityChips avatars={avatars} size={36} />
                  <p
                    className="text-mk-text-body text-[14.5px] font-medium"
                    aria-live="polite"
                  >
                    {count === undefined ? (
                      <span className="text-mk-text-muted">
                        Counting the puzzlers…
                      </span>
                    ) : (
                      <>
                        <strong className="text-mk-text-strong font-bold">
                          {count.toLocaleString()}
                        </strong>{" "}
                        puzzlers have already opened the box.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="opacity-60">
      ·
    </span>
  );
}
