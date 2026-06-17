import * as React from "react";

import CozyLanding from "./cozy";
import EditorialLanding from "./editorial";
import OriginalLanding from "./original";
import PlayfulLanding from "./playful";
import { type VariantId } from "./registry";
import RetroLanding from "./retro";
import { VariantSwitcher } from "./switcher";

// Renders the active landing-page variant and overlays the floating review
// switcher. The active variant is owned by the home route (driven by the `?v=`
// search param) and passed down so selection stays SSR-safe and shareable.

const VARIANT_COMPONENTS: Record<VariantId, React.ComponentType> = {
  original: OriginalLanding,
  playful: PlayfulLanding,
  editorial: EditorialLanding,
  cozy: CozyLanding,
  retro: RetroLanding,
};

export function Landing({
  variant,
  onVariantChange,
}: {
  variant: VariantId;
  onVariantChange: (id: VariantId) => void;
}) {
  const Active = VARIANT_COMPONENTS[variant] ?? PlayfulLanding;
  return (
    <>
      <Active />
      <VariantSwitcher current={variant} onChange={onVariantChange} />
    </>
  );
}
