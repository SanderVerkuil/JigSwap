import { Comment } from "../../domain";
import { CommentRepository } from "../ports/out/comment.repository";

// In-memory CommentRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs. Append-only: every save adds
// a new comment (comments may repeat for the same puzzle/author).
export class InMemoryCommentRepository implements CommentRepository {
  private readonly store: ReturnType<Comment["toState"]>[] = [];

  async save(comment: Comment): Promise<void> {
    this.store.push(comment.toState());
  }

  // Test helper: every stored comment, rehydrated.
  all(): Comment[] {
    return this.store.map((state) => Comment.rehydrate(state));
  }

  // Test helper: how many comments are currently stored.
  size(): number {
    return this.store.length;
  }
}
