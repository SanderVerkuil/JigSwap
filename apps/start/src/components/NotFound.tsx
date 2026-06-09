import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div style={{ padding: "1rem" }}>
      <p>This page does not exist.</p>
      <Link to="/">Go home</Link>
    </div>
  );
}
