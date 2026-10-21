export {};

// Create a type for the roles
export type Roles = "admin" | "moderator";

declare global {
  /** The build id, baked in at build time by vite-plugin-app-version.ts. */
  const __APP_VERSION__: string;

  interface CustomJwtSessionClaims {
    metadata: {
      role?: Roles;
    };
  }
}
