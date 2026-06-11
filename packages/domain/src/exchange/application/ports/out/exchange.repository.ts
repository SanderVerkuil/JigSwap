import { CopyId, Exchange, ExchangeId, MemberId } from "../../../domain";

// Outbound port: persistence for the Exchange aggregate. The 1b-convex adapter implements
// this over `ctx.db` (the `exchanges` table) behind a mapper; the domain never sees a row.
export interface ExchangeRepository {
  findById(id: ExchangeId): Promise<Exchange | null>;
  save(exchange: Exchange): Promise<void>;
  // Backs the dedup rule: at most one active proposed exchange per (initiator, requested copy).
  findActiveProposal(
    initiatorId: MemberId,
    requestedCopyId: CopyId,
  ): Promise<Exchange | null>;
}
