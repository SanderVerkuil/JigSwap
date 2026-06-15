import { Result } from "../../../../shared-kernel";
import {
  CommentId,
  CopyId,
  MemberId,
  PuzzleDefinitionId,
  SocialError,
} from "../../../domain";

// The command to post a comment. `authorId` is resolved from auth by the transport adapter;
// `puzzleId` is resolved from the owned copy the UI is keyed on. The raw `text` and optional
// `rating` are validated by the Comment aggregate. When `copyId` is set the comment is scoped to
// that owned copy (the owner's notes/rating); when absent it is a community review of the puzzle.
export interface PostCommentCommand {
  readonly authorId: MemberId;
  readonly puzzleId: PuzzleDefinitionId;
  readonly text: string;
  readonly rating?: number;
  readonly copyId?: CopyId;
}

// Inbound port: the post-comment use case. Returns the new CommentId on success, or a SocialError
// when the text is empty or the rating is out of range.
export interface PostComment {
  (cmd: PostCommentCommand): Promise<Result<CommentId, SocialError>>;
}
