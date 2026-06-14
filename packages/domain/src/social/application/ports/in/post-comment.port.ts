import { Result } from "../../../../shared-kernel";
import {
  CommentId,
  MemberId,
  PuzzleDefinitionId,
  SocialError,
} from "../../../domain";

// The command to post a community comment on a puzzle definition. `authorId` is resolved from auth
// by the transport adapter; `puzzleId` is resolved from the owned copy the UI is keyed on. The raw
// `text` and optional `rating` are validated by the Comment aggregate.
export interface PostCommentCommand {
  readonly authorId: MemberId;
  readonly puzzleId: PuzzleDefinitionId;
  readonly text: string;
  readonly rating?: number;
}

// Inbound port: the post-comment use case. Returns the new CommentId on success, or a SocialError
// when the text is empty or the rating is out of range.
export interface PostComment {
  (cmd: PostCommentCommand): Promise<Result<CommentId, SocialError>>;
}
