// What a count badge in the phone chrome shows, and how the control carrying it stays named.
const NAV_BADGE_MAX = 9;

type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function formatNavBadge(count: number): string {
  return count > NAV_BADGE_MAX ? `${NAV_BADGE_MAX}+` : String(count);
}

// The name to put in front of a control's full count; `t` is the "shell.mobile" namespace. Below
// the cap that count is what the badge shows. Past it the badge reads "9+", so that string joins
// the name too: the visible text stays part of the name (WCAG 2.5.3) next to the full count.
export function nameForNavBadge(
  t: Translator,
  name: string,
  count: number,
): string {
  return count > NAV_BADGE_MAX
    ? t("tabWithCount", { label: name, count: formatNavBadge(count) })
    : name;
}
