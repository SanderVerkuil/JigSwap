import { PhotoComment } from "../../domain";
import { PhotoCommentRepository } from "../ports/out/photo-comment.repository";

// In-memory PhotoCommentRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs. Append-only: every save adds
// a new comment (comments may repeat for the same photo/author).
export class InMemoryPhotoCommentRepository implements PhotoCommentRepository {
  private readonly store: ReturnType<PhotoComment["toState"]>[] = [];

  async save(comment: PhotoComment): Promise<void> {
    this.store.push(comment.toState());
  }

  // Test helper: every stored comment, rehydrated.
  all(): PhotoComment[] {
    return this.store.map((state) => PhotoComment.rehydrate(state));
  }

  // Test helper: how many comments are currently stored.
  size(): number {
    return this.store.length;
  }
}
