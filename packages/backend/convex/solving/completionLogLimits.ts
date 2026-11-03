// Bounds of the completion log's reads (listMyCompletionIndex, getMyCompletionsByIds).

// How many solves the lean index covers, newest logged first. No real member comes close; past it the
// oldest solves drop out of the log and its stats rather than the read failing.
export const COMPLETION_INDEX_CAP = 5000;

// The most full rows one read joins. Convex allows 4,096 index ranges per function and a row can
// cost up to about 16: the solve, its copy, puzzle, cover, box art, the copy gate on someone else's
// copy, the photo sidecars and one rendition per photo (MAX_PHOTOS). It also asks for up to 24 URLs:
// four for its thumbnail and four for each photo. Whether a URL takes up a range is inferred, not
// measured: this assumes it does, for a member with every photo on every solve, and leaves about 10% to
// spare. The log asks a page at a time (the web's HISTORY_PAGE_SIZE, which stays well below this), so
// this isn't how far it can be scrolled.
export const COMPLETION_ROWS_MAX = 100;
