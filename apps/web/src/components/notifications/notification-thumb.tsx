import { cn } from "@/lib/utils";

/** The subject's cover (decorative), greyed out when the subject is no longer available. */
export function NotificationThumb({
  url,
  unavailable,
}: {
  url: string | undefined;
  unavailable: boolean;
}) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={cn(
        "bg-muted size-10 shrink-0 rounded-md object-cover",
        unavailable && "grayscale",
      )}
    />
  );
}
