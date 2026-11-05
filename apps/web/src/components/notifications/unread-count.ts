// The backend stops counting unread notifications at 100 (notifications/unreadCount), so any count
// past this one is a lower bound: it shows as "99+" and is announced as "99+ unread notifications".
const UNREAD_SHOWN_MAX = 99;

export type Translator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

// The visible badge/stat number.
export function formatUnreadBadge(count: number): string {
  return count > UNREAD_SHOWN_MAX ? `${UNREAD_SHOWN_MAX}+` : String(count);
}

// The spoken/meta form of the count; `t` is the "notifications" namespace.
export function unreadNotificationsLabel(t: Translator, count: number): string {
  return count > UNREAD_SHOWN_MAX
    ? t("unreadCountCapped")
    : t("unreadCount", { count });
}
