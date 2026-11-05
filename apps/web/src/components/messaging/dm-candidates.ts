// Whom the inbox's "Message a member" picker offers (UX-114): members the
// viewer can already message under the ConnectionPolicy openDmThread enforces.
// Pure, so it unit-tests without React.
import type { gateway } from "@/gateway";
import type { MemberNameSource } from "@jigswap/contracts";
import type { FunctionReturnType } from "convex/server";
import type { AnyInboxThread } from "./format";

export type FollowEdge = FunctionReturnType<
  typeof gateway.social.following
>[number];

export interface DmCandidate {
  memberId: string;
  name: MemberNameSource;
  avatar?: string;
}

// `recent`: the revealed partners of the viewer's DM and exchange threads, in
// inbox order (an existing pair thread connects them). A thread that is
// blocked or read-only is left out, as is an anonymised or inactive partner.
// `mutual`: members who follow the viewer back (mutual follow connects them),
// minus the recent ones, by name; nameless entries last.
export function dmCandidates(
  inbox: readonly AnyInboxThread[],
  following: readonly FollowEdge[],
  followers: readonly FollowEdge[],
): { recent: DmCandidate[]; mutual: DmCandidate[] } {
  const seen = new Set<string>();
  const recent: DmCandidate[] = [];
  for (const thread of inbox) {
    const { subject } = thread;
    if (subject.kind === "circle" || thread.blocked || thread.readOnly) {
      continue;
    }
    if (subject.otherMember.anonymous) continue;
    const partner = subject.otherMember.member;
    if (!partner.isActive || seen.has(partner._id)) continue;
    seen.add(partner._id);
    recent.push({
      memberId: partner._id,
      name: partner,
      avatar: partner.avatar,
    });
  }

  const followsMe = new Set(followers.map((edge) => edge.memberId));
  const mutual: DmCandidate[] = [];
  for (const edge of following) {
    if (!followsMe.has(edge.memberId) || seen.has(edge.memberId)) continue;
    seen.add(edge.memberId);
    mutual.push({ memberId: edge.memberId, name: { name: edge.displayName } });
  }
  mutual.sort((a, b) => {
    const left = a.name.name;
    const right = b.name.name;
    if (!left || !right) return left ? -1 : right ? 1 : 0;
    return left.localeCompare(right, undefined, { sensitivity: "base" });
  });
  return { recent, mutual };
}
