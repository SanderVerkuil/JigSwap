import { cn } from "@/lib/utils";

// Body styling for rendered entry Markdown, from app tokens only (`.docs-prose` is tied to the
// marketing tokens and type scale). Body headings arrive demoted below the card's h3, so the
// selectors target h4/h5 (spec Part B §1.6).
export const WHATS_NEW_PROSE = cn(
  "text-[15px] leading-relaxed text-card-foreground",
  "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h4]:font-heading [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold",
  "[&_h5]:mt-4 [&_h5]:mb-1.5 [&_h5]:font-semibold",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1 [&_li::marker]:text-jigsaw-primary",
  "[&_a]:text-primary [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary/80",
  "[&_strong]:font-semibold",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
  "[&_img]:my-4 [&_img]:rounded-lg [&_img]:border",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
);
