import {
  memberInitials,
  resolveMemberDisplayName,
  type MemberNameSource,
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
