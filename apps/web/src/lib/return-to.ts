// A `returnTo` search param is only honoured as a same-app path: it must start with one "/" and
// not "//" or "/\" (both of which a browser resolves to another origin). Anything else is dropped.
export const safeReturnTo = (value: unknown): string | undefined =>
  typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : undefined;
