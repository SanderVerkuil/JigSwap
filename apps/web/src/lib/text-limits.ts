// Mirrors of the domain's text caps; the server refuses longer text. Both count UTF-16 code units
// after trimming, as an input's maxLength does, so the browser and the server agree.

/** Photo and copy comments (domain COMMENT_TEXT_MAX_LENGTH; server code CommentTextTooLong). */
export const COMMENT_TEXT_MAX_LENGTH = 1000;

/** Puzzle review text (domain REVIEW_TEXT_MAX_LENGTH; server code ReviewTextTooLong). */
export const REVIEW_TEXT_MAX_LENGTH = 2000;
