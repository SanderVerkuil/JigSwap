import { Comment, CommentId } from "../../domain";
import { CommentRepository } from "../ports/out/comment.repository";

// In-memory CommentRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs. Every save adds a new
// comment (comments may repeat for the same puzzle/author); remove drops the one with that id.
export class InMemoryCommentRepository implements CommentRepository {
  private store: ReturnType<Comment["toState"]>[] = [];

  async save(comment: Comment): Promise<void> {
    this.store.push(comment.toState());
  }

  async findById(id: CommentId): Promise<Comment | null> {
    const state = this.store.find((s) => s.id === id);
    return state ? Comment.rehydrate(state) : null;
  }

  async remove(comment: Comment): Promise<void> {
    this.store = this.store.filter((s) => s.id !== comment.id);
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
