import logoIcon from "@/components/common/header-icon/logo.png";

// Logo mark + two-tone wordmark: violet "Jig", green "Swap" (Fredoka 700).
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      <img
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
