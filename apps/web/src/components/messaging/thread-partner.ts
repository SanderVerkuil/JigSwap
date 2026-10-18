// The other participant of an inbox thread, when the viewer may know who they
// are: the revealed member of a DM. Null for an anonymised DM partner and for
// exchange threads (their inbox subject doesn't carry the partner yet). Pure,
// so it unit-tests without React.
import type { MemberView } from "@jigswap/contracts";
import type { InboxThread } from "./format";

export function threadPartner(thread: InboxThread): MemberView | null {
  const { subject } = thread;
  if (subject.kind !== "dm" || subject.otherMember.anonymous) return null;
  return subject.otherMember.member;
}
