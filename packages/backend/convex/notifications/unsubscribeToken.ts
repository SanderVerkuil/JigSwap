import { EMAIL_ELIGIBLE_TYPES, type NotificationType } from "@jigswap/domain";

// The signed link behind a notification email's one-click List-Unsubscribe header (SEC-84,
// RFC 8058). The token names the member and the ONE notification type the email was about, and is
// signed with the server-only EMAIL_UNSUBSCRIBE_SECRET:
//
//   v1.<userId>.<type>.<base64url HMAC-SHA256(secret, JSON ["emailUnsubscribe/v1", userId, type])>
//
// Only the holder of the email can use it, and only to switch off that type's email for that
// member: changing the id or the type breaks the signature. Tokens don't expire, because a mail
// client may offer the unsubscribe long after delivery; rotating the secret invalidates every link
// already sent. Read by sendEmail (Node runtime) and the /email/unsubscribe route (Convex runtime),
// so this module uses Web Crypto only.

export const EMAIL_UNSUBSCRIBE_PATH = "/email/unsubscribe";

// The same floor as ANON_REF_SECRET and INVITE_EMAIL_HMAC_KEY: a short key could be brute-forced
// from one signed link. `openssl rand -base64 48` gives 64 characters.
export const EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH = 32;

const VERSION = "v1";
const encoder = new TextEncoder();

export interface EmailUnsubscribeTarget {
  readonly userId: string;
  readonly type: NotificationType;
}

/** The configured secret, or null when unset or too short (the feature is then off). */
export const emailUnsubscribeSecretOf = (
  env: Record<string, string | undefined>,
): string | null => {
  const secret = env["EMAIL_UNSUBSCRIBE_SECRET"];
  return secret !== undefined &&
    secret.length >= EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH
    ? secret
    : null;
};

// Only a type that is ever emailed gets (and accepts) a link.
const isEmailedType = (type: string): type is NotificationType =>
  EMAIL_ELIGIBLE_TYPES.has(type as NotificationType);

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );

const signedPayload = (userId: string, type: string) =>
  encoder.encode(JSON.stringify(["emailUnsubscribe/v1", userId, type]));

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(
      atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")),
      (char) => char.charCodeAt(0),
    );
  } catch {
    return null;
  }
};

/** The signed token for one member and one notification type. */
export const emailUnsubscribeTokenOf = async (
  secret: string,
  userId: string,
  type: string,
): Promise<string> => {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    signedPayload(userId, type),
  );
  return `${VERSION}.${userId}.${type}.${toBase64Url(new Uint8Array(signature))}`;
};

/** The member and type a token was signed for, or null for anything not signed with `secret`. */
export const verifyEmailUnsubscribeToken = async (
  secret: string,
  token: string,
): Promise<EmailUnsubscribeTarget | null> => {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, userId, type, signatureText] = parts;
  if (version !== VERSION || userId === "" || !isEmailedType(type)) {
    return null;
  }
  const signature = fromBase64Url(signatureText);
  if (signature === null) return null;
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    signature,
    signedPayload(userId, type),
  );
  return valid ? { userId, type } : null;
};

/**
 * The one-click unsubscribe URL for an email to `userId` about `type`, on this deployment's HTTP
 * host (CONVEX_SITE_URL, set by Convex). Undefined, so no header is sent, when the secret is
 * missing or short, the site URL is not https (RFC 8058 requires it), or the type is never emailed.
 */
export const emailUnsubscribeUrlOf = async (
  env: Record<string, string | undefined>,
  userId: string,
  type: string,
): Promise<string | undefined> => {
  const secret = emailUnsubscribeSecretOf(env);
  const site = env["CONVEX_SITE_URL"];
  if (secret === null || site === undefined || !isEmailedType(type)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(EMAIL_UNSUBSCRIBE_PATH, site);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  url.searchParams.set(
    "token",
    await emailUnsubscribeTokenOf(secret, userId, type),
  );
  return url.toString();
};
