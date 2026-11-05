import { InviteLinkError } from "./invite-link-error";
import { InviteShareActions } from "./invite-share-actions";
import { useMyInviteLink } from "./use-my-invite-link";

// The member's own invite link through the share sheet (Web Share, Copy link, Email, WhatsApp).
// No username needed: the link is the stable member-id URL.
export function NetworkInvite({
  memberId,
  onShared,
}: {
  memberId: string;
  onShared?: () => void;
}) {
  const { url, failed, refetch } = useMyInviteLink(memberId);
  if (failed) return <InviteLinkError onRetry={refetch} />;
  return <InviteShareActions url={url} kind="network" onShared={onShared} />;
}
