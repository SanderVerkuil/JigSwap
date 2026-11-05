import { useUser } from "@/compat/clerk";
import { useNow, useTranslations } from "use-intl";

// A member's first day counts as their first visit: long enough to cover the first session.
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;

// True while the account is less than a day old. A creation time slightly ahead of this clock
// (clock skew) is as new as it gets; an unknown one is not new.
export function isNewAccount(
  createdAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!createdAt) return false;
  return now.getTime() - createdAt.getTime() < NEW_ACCOUNT_MS;
}

// The dashboard greeting: "Welcome, {name}!" on the account's first day, "Welcome back, {name}!"
// after that. useNow() without an interval returns the server render's `now` during hydration, so
// server and client agree.
export function useDashboardGreeting(): string {
  const t = useTranslations("shell");
  const { user } = useUser();
  const now = useNow();
  const name = user?.firstName;
  if (isNewAccount(user?.createdAt, now)) {
    return name ? t("welcomeNew", { name }) : t("welcomeNewAnonymous");
  }
  return name ? t("welcome", { name }) : t("welcomeAnonymous");
}
