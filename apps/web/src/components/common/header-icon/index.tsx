import Image from "next/image";
import HeaderIconImage from "./logo.png";

export function HeaderIcon() {
  return (
    <Image
      src={HeaderIconImage}
      alt="JigSwap Logo"
      className="h-48 w-auto mx-auto"
    />
  );
}
