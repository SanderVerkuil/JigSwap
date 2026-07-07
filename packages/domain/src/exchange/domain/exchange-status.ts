// The lifecycle states of an Exchange (proposal §1.4 state machine). These match the
// persisted `exchanges.status` column 1:1, so no legacy translation is needed.
//   proposed  -> initial offer
//   accepted  -> recipient agreed; awaiting physical exchange + dual confirmation
//   completed -> both parties confirmed; ownership transferred
//   rejected  -> recipient declined the offer
//   cancelled -> initiator withdrew the deal
//   disputed  -> a party flagged a problem
export type ExchangeStatus =
  "proposed" | "accepted" | "completed" | "rejected" | "cancelled" | "disputed";
