import {
  memberInitials,
  resolveMemberDisplayName,
  type ExchangePartyState,
  type MemberNameSource,
  type MemberView,
  type ProjectedMember,
} from "@jigswap/contracts";
import { useCallback } from "react";
import { useTranslations } from "use-intl";

/**
 * The web side of the shared member display-name resolution: returns a formatter that resolves
 * full name → email (only when the source carries it, i.e. the viewer may see it) → username →
 * the localized generic label ("Puzzler" / "Puzzelaar"). Use it for EVERY rendered member name.
 * For read models that ship an already-resolved name (e.g. `displayName`), pass it as `name`.
 */
export function useMemberDisplayName(): (
  source: MemberNameSource | null | undefined,
) => string {
  const t = useTranslations("common");
  return useCallback(
    (source) =>
      resolveMemberDisplayName(source ?? {})?.text ?? t("genericMember"),
    [t],
  );
}

/**
 * The avatar initial for a member, from whichever source the display name resolves to.
 * `undefined` when the member resolves to the generic label — render a person icon instead
 * (see MemberInitial).
 */
export const memberInitialOf = (
  source: MemberNameSource | null | undefined,
): string | undefined => memberInitials(resolveMemberDisplayName(source ?? {}));

/**
 * A trade party's name from its exchange-view state: "Deleted member" when the account is gone,
 * else the member's resolved name (a hidden party is null, so it gets the generic label).
 */
export function usePartyDisplayName(): (
  member: MemberNameSource | null | undefined,
  state: ExchangePartyState | undefined,
) => string {
  const t = useTranslations("notifications.rich");
  const displayName = useMemberDisplayName();
  return useCallback(
    (member, state) =>
      state === "departed" ? t("deletedMember") : displayName(member),
    [t, displayName],
  );
}

/**
 * A privacy-projected member (the server's `ProjectedMember`), structurally: revealed members carry
 * their name source; hidden ones carry nothing identifying, plus `departed` when the account is
 * gone or deactivated.
 */
type ProjectedMemberSource =
  | { anonymous: false; member: MemberNameSource }
  | { anonymous: true; departed?: boolean };

/**
 * Returns a formatter for a privacy-projected member's label: a revealed member's display name; a
 * departed account's "Deleted member"; otherwise the caller's localized anonymous label (each
 * surface keeps its own "Anonymous user" key). Never a real name for a hidden member.
 */
export function useProjectedMemberName(): (
  member: ProjectedMemberSource,
  anonymousLabel: string,
) => string {
  const t = useTranslations("notifications.rich");
  const displayName = useMemberDisplayName();
  return useCallback(
    (member, anonymousLabel) =>
      !member.anonymous
        ? displayName(member.member)
        : member.departed
          ? t("deletedMember")
          : anonymousLabel,
    [t, displayName],
  );
}

/**
 * A review or comment author as the server sent it. Deploy skew: production web ships before
 * Convex, and a backend that predates SEC-11's author projection still sends a plain MemberView
 * (no `anonymous`). Such an author reads as revealed (that backend already sent their identity),
 * or as departed when `isActive` is false; a projected author passes through unchanged. Delete
 * once every backend serves ProjectedMember authors.
 */
export const projectedAuthorOf = (
  author: ProjectedMember | (MemberView & { anonymous?: undefined }),
): ProjectedMember =>
  author.anonymous !== undefined
    ? author
    : author.isActive === false
      ? { anonymous: true, anonRef: "", departed: true }
      : { anonymous: false, member: author };
