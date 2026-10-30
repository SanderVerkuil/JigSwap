import { PhotoComment, PhotoCommentId } from "../../domain";
import { PhotoCommentRepository } from "../ports/out/photo-comment.repository";

// In-memory PhotoCommentRepository for use-case tests. Stores persisted state and rehydrates a fresh
// aggregate on read, mirroring the round-trip a real adapter performs. Every save adds a new comment
// (comments may repeat for the same photo/author); remove drops the one with that id.
export class InMemoryPhotoCommentRepository implements PhotoCommentRepository {
  private store: ReturnType<PhotoComment["toState"]>[] = [];

  async save(comment: PhotoComment): Promise<void> {
    this.store.push(comment.toState());
  }

  async findById(id: PhotoCommentId): Promise<PhotoComment | null> {
    const state = this.store.find((s) => s.id === id);
    return state ? PhotoComment.rehydrate(state) : null;
  }

  async remove(comment: PhotoComment): Promise<void> {
    this.store = this.store.filter((s) => s.id !== comment.id);
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
