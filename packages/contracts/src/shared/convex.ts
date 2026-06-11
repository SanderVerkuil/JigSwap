// Convex system fields every persisted document carries. Ids are branded strings at runtime; the
// contracts layer stays Convex-free, so we model them as plain strings (assignable both ways).
export interface ConvexSystemFields {
  _id: string;
  _creationTime: number;
}
