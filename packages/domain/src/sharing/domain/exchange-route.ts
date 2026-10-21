import { canExchangeWithin, PermissionLevel } from "./permission-level";

// One way a requester reaches another member's copy. The caller resolves which apply; this module
// only decides whether they allow an exchange request.
//   public       — the owner's profile is public and the copy is open
//   household    — the owner is in the requester's household
//   mutualFollow — the requester and the owner follow each other
//   circle       — a circle that holds the share, both are current members; `level` is the
//                  REQUESTER's permission in that circle
export type ExchangeRoute =
  | { readonly kind: "public" }
  | { readonly kind: "household" }
  | { readonly kind: "mutualFollow" }
  | { readonly kind: "circle"; readonly level: PermissionLevel };

// May the requester ask for an exchange? Yes if ANY route allows it: every non-circle route does,
// and a circle route does when the requester's level there is Exchange or Admin. A ViewOnly seat in
// one circle never cancels another route. No route at all means no.
export const mayExchangeVia = (routes: readonly ExchangeRoute[]): boolean =>
  exchangeAllowedVia(routes) !== null;

// WHICH kind of route allows the request: "direct" when a non-circle route does (they all do),
// "circle" when only Exchange/Admin circle seats do, null when nothing does. Recorded on the request
// so accept knows whether the requester's circle standing is what it rested on.
export const exchangeAllowedVia = (
  routes: readonly ExchangeRoute[],
): "direct" | "circle" | null => {
  if (routes.some((route) => route.kind !== "circle")) return "direct";
  return routes.some(
    (route) => route.kind === "circle" && canExchangeWithin(route.level),
  )
    ? "circle"
    : null;
};
