import Image from "next/image";
import HeaderIcon from "./logo.png";

export function HeaderLogo() {
  return (
    <>
      <Image src={HeaderIcon} alt="JigSwap Logo" className="pl-4 h-8 w-auto" />
    </>
  );
}
