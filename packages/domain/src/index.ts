// CopyId is owned by the Personal Library (the Copy aggregate); the Exchange context only
// borrows it as a foreign reference. Both contexts declare the identical branded type, so we
// resolve the barrel ambiguity by sourcing CopyId from its owning context.
export type { CopyId } from "./library";

export * from "./catalog";
export * from "./exchange";
export * from "./library";
export * from "./shared-kernel";
