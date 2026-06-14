import {
  toCommentId,
  toFollowId,
  toPhotoCommentId,
  toProfileId,
} from "../../../shared-kernel";
import { CommentId, FollowId, PhotoCommentId, ProfileId } from "../../domain";
import {
  CommentIdGenerator,
  FollowIdGenerator,
  PhotoCommentIdGenerator,
  ProfileIdGenerator,
} from "../ports/out/id-generators";

// Deterministic FollowIdGenerator for tests: follow-1, follow-2, ...
export class SequentialFollowIdGenerator implements FollowIdGenerator {
  private counter = 0;

  next(): FollowId {
    this.counter += 1;
    return toFollowId(`follow-${this.counter}`);
  }
}

// Deterministic ProfileIdGenerator for tests: profile-1, profile-2, ...
export class SequentialProfileIdGenerator implements ProfileIdGenerator {
  private counter = 0;

  next(): ProfileId {
    this.counter += 1;
    return toProfileId(`profile-${this.counter}`);
  }
}

// Deterministic CommentIdGenerator for tests: comment-1, comment-2, ...
export class SequentialCommentIdGenerator implements CommentIdGenerator {
  private counter = 0;

  next(): CommentId {
    this.counter += 1;
    return toCommentId(`comment-${this.counter}`);
  }
}

// Deterministic PhotoCommentIdGenerator for tests: photo-comment-1, photo-comment-2, ...
export class SequentialPhotoCommentIdGenerator implements PhotoCommentIdGenerator {
  private counter = 0;

  next(): PhotoCommentId {
    this.counter += 1;
    return toPhotoCommentId(`photo-comment-${this.counter}`);
  }
}
