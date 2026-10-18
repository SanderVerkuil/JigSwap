// What a notification is about, as a typed reference. Like `relatedId`, every id here is an OPAQUE
// string: Notifications never loads or imports the referenced aggregate (Exchange, Messaging,
// Social, Catalog, ...). The edges resolve the reference at read time (live state, deep link) so
// the stored row never has to snapshot names or statuses.
export type NotificationSubject =
  | { readonly kind: "exchange"; readonly exchangeId: string }
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "followRequest"; readonly requestId: string }
  | { readonly kind: "householdInvite"; readonly inviteId: string }
  | { readonly kind: "household"; readonly householdId: string }
  | { readonly kind: "circleInvite"; readonly inviteId: string }
  | { readonly kind: "circle"; readonly circleId: string }
  | { readonly kind: "puzzle"; readonly puzzleId: string }
  | { readonly kind: "copy"; readonly copyId: string }
  | { readonly kind: "goal"; readonly goalId: string }
  | { readonly kind: "review"; readonly reviewId: string }
  | { readonly kind: "changeProposal"; readonly proposalId: string }
  | { readonly kind: "whatsNew"; readonly entryId: string }
  | { readonly kind: "connectionOffer"; readonly offerId: string };
