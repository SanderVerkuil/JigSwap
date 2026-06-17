import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow } from "@/components/marketing/section";

const STEPS = [
  {
    n: "01",
    title: "Shelve",
    body: "Add your puzzles to your digital shelf, piece count and box art included.",
  },
  {
    n: "02",
    title: "Share",
    body: "Lend or swap a box with someone in the community.",
  },
  {
    n: "03",
    title: "Track",
    body: "Always see which box is out, and whose table it's on.",
  },
];

// 01 / 02 / 03 assembly instructions with dashed connectors (assembly-diagram
// feel). Horizontal connectors on desktop, a vertical gutter rule on mobile.
export function AssemblySteps() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6">
      <Eyebrow>Assembly</Eyebrow>
      <h2 className="font-mk-heading text-mk-text-strong mt-3.5 text-[clamp(28px,4vw,40px)] leading-[1.1] font-bold tracking-tight">
        Three steps to get going
      </h2>

      <ol className="mt-10 grid grid-cols-3 gap-8 max-[860px]:grid-cols-1 max-[860px]:gap-0">
        {STEPS.map((step, i) => (
          <Reveal key={step.n} delay={i * 110}>
            <li className="relative max-[860px]:pl-10">
              {/* Mobile vertical connector */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="v-connector-v absolute top-2 bottom-[-28px] left-[14px] hidden max-[860px]:block"
                />
              )}
              {/* Desktop horizontal connector */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="v-connector-h absolute top-[clamp(20px,4vw,42px)] right-[-22px] hidden w-[44px] min-[861px]:block"
                />
              )}

              <span
                aria-hidden="true"
                className="font-mk-heading v-offset block text-[clamp(40px,8vw,84px)] leading-none font-extrabold max-[860px]:text-[clamp(36px,12vw,56px)]"
                style={{ color: "var(--mk-seed-primary)" }}
              >
                {step.n}
              </span>
              <h3 className="font-mk-heading text-mk-text-strong mt-3 text-[20px] font-bold tracking-tight">
                {step.title}
              </h3>
              <p className="text-mk-text-body mt-2 max-w-[34ch] text-[15px] leading-relaxed text-pretty max-[860px]:pb-8">
                {step.body}
              </p>
            </li>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}
