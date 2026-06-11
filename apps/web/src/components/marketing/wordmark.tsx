import { Image } from "@/compat/image";
// Icon-only mark (hands-in-puzzle-piece) — the header-icon asset is the
// stacked lockup with the wordmark text baked in underneath.
import logoIcon from "@/components/marketing/assets/icon.png";

// Logo mark + two-tone wordmark: violet "Jig", green "Swap" (Fredoka 700).
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      <Image
        src={logoIcon}
        alt=""
        width={size + 8}
        height={size + 8}
        className="block rounded-[7px]"
      />
      <span
        className="font-mk-heading font-bold leading-none tracking-[-0.01em]"
        style={{ fontSize: size }}
      >
        <span className="text-mk-violet-600">Jig</span>
        <span className="text-mk-green-600">Swap</span>
      </span>
    </span>
  );
}
