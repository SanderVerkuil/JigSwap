// The other participant of an inbox thread, when the viewer may know who they
// are: the revealed `otherMember` of a DM or exchange subject. Null for an
// anonymised partner. Pure, so it unit-tests without React.
import type { MemberView } from "@jigswap/contracts";
import type { InboxThread } from "./format";

export function threadPartner(thread: InboxThread): MemberView | null {
  const { otherMember } = thread.subject;
  return otherMember.anonymous ? null : otherMember.member;
}
