// Bounds of the completion log's reads (listMyCompletionIndex, getMyCompletionsByIds).

// How many solves the lean index covers, newest logged first. No real member comes close; past it the
// oldest solves drop out of the log and its stats rather than the read failing.
export const COMPLETION_INDEX_CAP = 5000;

// The most full rows one read joins: each costs its copy, puzzle, cover and photo sidecars. The log
// asks for what's on screen, so this is as far as it can be scrolled.
export const COMPLETION_ROWS_MAX = 1000;
