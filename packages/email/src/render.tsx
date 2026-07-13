import { render } from "@react-email/render";
import {
  DEFAULT_PARAMS,
  EMAIL_COPY,
  EMAIL_TYPES,
  type EmailLocale,
  type EmailType,
  FOOTER,
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

export const renderEmail = async (
  input: RenderEmailInput,
): Promise<RenderedEmail> => {
  const copy = EMAIL_COPY[input.type][input.locale];
  const values = { ...DEFAULT_PARAMS[input.locale], ...input.params };
  const footer = FOOTER[input.locale];

  const element = (
    <NotificationEmail
      heading={interpolate(copy.heading, values)}
      body={interpolate(copy.body, values)}
      ctaLabel={copy.cta}
      // baseUrl must be an origin (no path): new URL("/x", "https://a/b") drops "/b".
      ctaUrl={new URL(
        ctaPath(input.type, input.relatedId),
        input.baseUrl,
      ).toString()}
      footerText={footer.text}
      footerLinkLabel={footer.linkLabel}
      footerLinkUrl={new URL("/notifications", input.baseUrl).toString()}
    />
  );

  // The From display name carries the actor so the inbox line reads "Sander Verkuil | JigSwap"
  // instead of a bare brand; falls back to the brand when the event has no actor (never the
  // localized "Someone"/"Iemand" placeholder). Use the RAW param, not the DEFAULT_PARAMS fallback.
  const actorName = input.params["actorName"];

  return {
    subject: interpolate(copy.subject, values),
    html: await render(element),
    text: await render(element, { plainText: true }),
    fromName: actorName ? `${actorName} | JigSwap` : "JigSwap",
  };
};
