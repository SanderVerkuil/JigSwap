import { Image } from "@/compat/image";
// Icon-only mark (hands-in-puzzle-piece) — the header-icon asset is the
// stacked lockup with the wordmark text baked in underneath.
import logoIcon from "@/components/marketing/assets/icon.png";

// Logo mark + two-tone wordmark. The logo keeps its own colours whatever the theme's primary does.
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
        className="font-logo leading-none font-bold"
        style={{ fontSize: size }}
      >
        <span className="text-logo-jig">Jig</span>
        <span className="text-logo-swap">Swap</span>
      </span>
    </span>
  );
}
