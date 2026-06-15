import { Result } from "../../../../shared-kernel";
import {
  MemberId,
  PhotoCommentId,
  PhotoId,
  SocialError,
} from "../../../domain";

// The command to post a discussion comment on a single shared photo. `authorId` is resolved from
// auth by the transport adapter; `photoId` identifies the `ownedPuzzleImages` row the lightbox is
// keyed on. The raw `text` is validated by the PhotoComment aggregate. There is no rating — photo
// comments are plain text.
export interface PostPhotoCommentCommand {
  readonly authorId: MemberId;
  readonly photoId: PhotoId;
  readonly text: string;
}

// Inbound port: the post-photo-comment use case. Returns the new PhotoCommentId on success, or a
// SocialError when the text is empty.
export interface PostPhotoComment {
  (cmd: PostPhotoCommentCommand): Promise<Result<PhotoCommentId, SocialError>>;
}
