import { inviterNameForEmail } from "@jigswap/domain";
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
   * model). Absent, null, not root-relative or resolving off the baseUrl origin falls back to the
   * legacy per-type ctaPath.
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

// The actor's name is member-chosen text that reaches the subject, heading and body. It follows
// the rule invitation emails apply to the inviter's name (domain inviterNameForEmail): line breaks
// and control characters flattened, bidi and other invisible format characters dropped, words that
// look like a link or an email address dropped, at most INVITER_NAME_MAX_LENGTH characters. A name
// with nothing left is dropped, so the localized default ("Someone") stands in.
const withSafeActorName = (
  params: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  const { actorName, ...rest } = params;
  if (actorName === undefined) return params;
  const name = inviterNameForEmail(actorName);
  return name === undefined ? rest : { ...rest, actorName: name };
};

// Only a root-relative path that stays on the base URL's origin may become the CTA. The origin is
// checked by resolving the href with the WHATWG URL parser (the one browsers use on the link), so
// "/\host", "/<tab>/host" and other forms that pass a "/"-prefix test but resolve off-site fall
// back too.
const isSameOriginPath = (
  href: string | null | undefined,
  baseUrl: string,
): href is string => {
  if (!href || !href.startsWith("/")) return false;
  try {
    return new URL(href, baseUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
};

export const renderEmail = async (
  input: RenderEmailInput,
): Promise<RenderedEmail> => {
  const copy = EMAIL_COPY[input.type][input.locale];
  const params = input.actorAnonymous
    ? { ...input.params, actorName: FORMER_MEMBER[input.locale] }
    : withSafeActorName(input.params);
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
  const path = isSameOriginPath(input.href, input.baseUrl)
    ? input.href
    : fallbackPath;

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

  return {
    subject: interpolate(copy.subject, values),
    html: await render(element),
    text: await render(element, { plainText: true }),
    // Always the brand, as invitation emails do: the sender line of a jigswap.site email never
    // carries member-chosen text, so a display name cannot pose as JigSwap there. The actor is
    // named in the subject and body instead.
    fromName: "JigSwap",
  };
};
