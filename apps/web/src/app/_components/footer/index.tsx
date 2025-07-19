"use client";

import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t py-8 px-4">
      <div className="container mx-auto text-center text-muted-foreground">
        <div className="flex items-center justify-center space-x-2 mb-4">
          <span className="text-xl">🧩</span>
          <span className="font-semibold">JigSwap</span>
        </div>
        <p className="text-sm">
          The complete platform for jigsaw puzzle enthusiasts - manage, trade,
          connect, and grow.
        </p>
        <div className="mt-4 flex justify-center space-x-6 text-sm">
          <Link href="/about" className="hover:text-foreground">
            About
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/contact" className="hover:text-foreground">
            Contact
          </Link>
        </div>
      </div>
    </footer>
  );
}
