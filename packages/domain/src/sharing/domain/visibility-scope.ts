// The unified 6-level visibility model (§1.4) a copy/collection owner attaches to their content.
// Modelled as a literal union with capability helpers rather than a pile of booleans on a row —
// "sharing is a policy, not a pile of flags" (§1.1). The levels, low → high openness:
//
//   private      → only the owner sees it; nobody transacts.
//   friendCircle → only members who share a circle with the owner may see it.
//   visible      → anyone may see it, but nobody may transact (a public showcase).
//   lendable     → publicly visible; may be borrowed (Lend).
//   swappable    → publicly visible; may be swapped (Swap).
//   tradeable    → publicly visible; may be traded/sold (Trade).
export type VisibilityScope =
  | "private"
  | "friendCircle"
  | "visible"
  | "lendable"
  | "swappable"
  | "tradeable";

// The kind of transaction a viewer wants to perform. Mirrors Exchange's kinds; passed as a
// primitive so the policy can gate the higher scopes by transaction kind without importing
// Exchange. `view` is folded into canView, so this union covers only the transacting verbs.
export type TransactionKind = "lend" | "swap" | "trade";

// Scopes that grant a PUBLIC view (no circle membership required). friendCircle and private are
// deliberately absent — they are gated separately by the policy.
const PUBLICLY_VIEWABLE: ReadonlySet<VisibilityScope> = new Set([
  "visible",
  "lendable",
  "swappable",
  "tradeable",
]);

// Which transaction kind each transactable scope permits. `visible` permits viewing but no
// transaction, so it (and the non-public scopes) are absent.
const TRANSACTABLE: Readonly<Partial<Record<VisibilityScope, TransactionKind>>> = {
  lendable: "lend",
  swappable: "swap",
  tradeable: "trade",
};

// True for any scope that lets a non-owner, non-circle viewer see the content.
export const isPubliclyViewable = (scope: VisibilityScope): boolean =>
  PUBLICLY_VIEWABLE.has(scope);

// True iff the scope permits the given transaction kind for anyone allowed to transact. `visible`
// and the non-public scopes never permit a transaction.
export const permitsTransaction = (
  scope: VisibilityScope,
  kind: TransactionKind,
): boolean => TRANSACTABLE[scope] === kind;
