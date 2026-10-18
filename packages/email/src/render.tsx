import { render } from "@react-email/render";
import {
  DEFAULT_PARAMS,
  EMAIL_COPY,
  EMAIL_TYPES,
  FOOTER,
  FORMER_MEMBER,
  type EmailLocale,
  type EmailType,
} from "./copy";
import { NotificationEmail } from "./notification-email";
import { ctaPath } from "./urls";

export const isEmailType = (type: string): type is EmailType =>
  (EMAIL_TYPES as readonly string[]).includes(type);

export interface RenderEmailInput {
  readonly type: EmailType;
  readonly params: Readonly<Record<string, string>>;
  readonly locale: EmailLocale;
  readonly baseUrl: string;
  readonly relatedId?: string;
  /**
   * The notification's resolved in-app deep link (a root-relative path from the backend read
   * model). Absent, null or not root-relative falls back to the legacy per-type ctaPath.
   */
  readonly href?: string | null;
  /** The resolved actor is a deleted or deactivated member: label them FORMER_MEMBER, never by name. */
  readonly actorAnonymous?: boolean;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly fromName: string;
}

const interpolate = (
  template: string,
  values: Readonly<Record<string, string>>,
): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const tokensOf = (template: string): string[] =>
  Array.from(template.matchAll(/\{(\w+)\}/g), (m) => m[1] as string);

// Whether `params` carries a (non-empty) value for every token, optionally ignoring some.
const hasValues = (
  template: string,
  params: Readonly<Record<string, string>>,
  ignore?: string,
): boolean =>
  tokensOf(template).every((key) => key === ignore || !!params[key]);

// Only a root-relative path may become the CTA: an absolute or protocol-relative href would let the
// link leave the configured base URL.
const isRootRelative = (href: string | null | undefined): href is string =>
  !!href && href.startsWith("/") && !href.startsWith("//");

export const renderEmail = async (
  input: RenderEmailInput,
): Promise<RenderedEmail> => {
  const copy = EMAIL_COPY[input.type][input.locale];
  const params = input.actorAnonymous
    ? { ...input.params, actorName: FORMER_MEMBER[input.locale] }
    : input.params;
  const values = { ...DEFAULT_PARAMS[input.locale], ...params };
  const footer = FOOTER[input.locale];
  const messageKind = params["messageKind"];
  const mediaBody =
    messageKind === "image" || messageKind === "location"
      ? copy.mediaBody?.[messageKind]
      : undefined;
  const body =
    mediaBody ??
    (copy.richBody && hasValues(copy.richBody, params, "actorName")
      ? copy.richBody
      : copy.body);
  const detail =
    copy.detail && hasValues(copy.detail, params)
      ? interpolate(copy.detail, values)
      : undefined;
  const fallbackPath = ctaPath(input.type, input.relatedId);
  const path = isRootRelative(input.href) ? input.href : fallbackPath;

  const element = (
    <NotificationEmail
      heading={interpolate(copy.heading, values)}
      body={interpolate(body, values)}
      detail={detail}
      ctaLabel={path !== fallbackPath && copy.deepCta ? copy.deepCta : copy.cta}
      // baseUrl must be an origin (no path): new URL("/x", "https://a/b") drops "/b".
      ctaUrl={new URL(path, input.baseUrl).toString()}
      footerText={footer.text}
      footerLinkLabel={footer.linkLabel}
      footerLinkUrl={new URL(
        "/notifications/preferences",
        input.baseUrl,
      ).toString()}
    />
  );

  // The From display name carries the actor so the inbox line reads "Sander Verkuil | JigSwap"
  // instead of a bare brand; falls back to the brand when the event has no actor (never the
  // localized "Someone"/"Iemand" placeholder, nor the "Former member" label). Use the RAW param,
  // not the DEFAULT_PARAMS fallback.
  const actorName = input.actorAnonymous
    ? undefined
    : input.params["actorName"];

  return {
    subject: interpolate(copy.subject, values),
    html: await render(element),
    text: await render(element, { plainText: true }),
    fromName: actorName ? `${actorName} | JigSwap` : "JigSwap",
  };
};
