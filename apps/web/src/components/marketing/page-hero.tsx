import { Container } from "@/components/marketing/container";
import { ENTER } from "@/components/marketing/home/classes";
import { cn } from "@/lib/utils";
import * as React from "react";

// Sub-page header band: flat sky continuous with the header. The title runs the full measure at the
// home page's scale; under it the lead and action stand on the left, and an `aside` picture, when the
// page has one, stands on the band's bottom edge on the right. `below` lays a page's own content across
// the foot of the band, and `children` sits under the lead (the docs search box). Only the lead and
// action enter; the picture is simply there.
export function PageHero({
  title,
  lead,
  action,
  aside,
  below,
  children,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  action?: React.ReactNode;
  aside?: React.ReactNode;
  below?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-mk-sky text-mk-text-strong">
      <Container className="pt-[clamp(20px,3vw,44px)]">
        <h1 className="font-mk-heading text-[clamp(38px,6vw,104px)] leading-[1.03] font-normal tracking-[-0.015em] text-balance">
          {title}
        </h1>
      </Container>
      <div
        className={cn(
          "mt-5",
          aside &&
            "lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-10",
        )}
      >
        <Container
          className={cn(
            "pb-[clamp(24px,3vw,44px)]",
            aside && "lg:self-start lg:pr-0",
            ENTER,
            "motion-safe:delay-[60ms]",
          )}
        >
          {lead && (
            <p className="max-w-[46ch] text-[clamp(18px,1.5vw,21px)] leading-normal text-pretty">
              {lead}
            </p>
          )}
          {/* With hideActionNearHero the header hides its copy of this action while this one is in view. */}
          {action && (
            <div data-hero-action="" className="mt-6">
              {action}
            </div>
          )}
          {children && <div className="mt-6">{children}</div>}
        </Container>
        {aside && <div className="min-w-0 lg:self-end">{aside}</div>}
      </div>
      {below}
    </div>
  );
}
