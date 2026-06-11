import { ExchangeId, Thread, ThreadId } from "../../../domain";

// Outbound port: persistence for the Thread aggregate. The 1b-convex adapter implements this over
// `ctx.db` behind a mapper; the domain never sees a row. `findByExchange` backs the one-thread-
// per-exchange rule (the OpenThread use case looks up by exchange before opening).
export interface ThreadRepository {
  findByExchange(exchangeId: ExchangeId): Promise<Thread | null>;
  findById(threadId: ThreadId): Promise<Thread | null>;
  save(thread: Thread): Promise<void>;
}
