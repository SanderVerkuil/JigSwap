import Image from "next/image";
import HeaderIconImage from "./logo.png";

interface HeaderIconProps {
  className?: string;
  priority?: boolean;
  sizes?: string;
}

export function HeaderIcon({ className, priority, sizes }: HeaderIconProps) {
  return (
    <Image
      src={HeaderIconImage}
      alt="JigSwap Logo"
      className={"h-48 w-auto mx-auto object-contain " + (className ?? "")}
      placeholder="blur"
      priority={priority}
      sizes={sizes}
    />
  );
}
