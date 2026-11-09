import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { Art } from "@/components/marketing/art";
import canalBoat from "@/components/marketing/assets/art/crops/canal-boat.webp";
import floorLiving from "@/components/marketing/assets/art/floor-living.webp";
import streetTall from "@/components/marketing/assets/art/street-tall.webp";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gateway } from "@/gateway";
import { convexErrorCode } from "@/lib/convex-error-code";
import { seoHead } from "@/lib/seo-head";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/contact")({
  head: ({ match }) => seoHead(match, "contact"),
  component: ContactPage,
});

const CHANNELS = ["email", "support", "privacy"] as const;

// Contact: the form on a white drawer beside the street, then the addresses. Submissions persist via
// the public gateway.contact.submit mutation (admin triage), not a fake success state.
function ContactPage() {
  const t = useTranslations("marketing.contactPage");
  return (
    <main id={MAIN_CONTENT_ID}>
      <PageHero
        title={t("heroTitle")}
        lead={t("heroLead")}
        below={
          <>
            <Container>
              {/* The form comes first in the DOM, so on phones (one column) it starts right under
                  the lead and is reached first. From lg the grid puts the street back on its left. */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
                <div className="lg:col-start-2 lg:row-start-1">
                  <ContactForm />
                </div>
                <div className="lg:col-start-1 lg:row-start-1">
                  <Art
                    src={streetTall}
                    width={650}
                    height={864}
                    alt={t("artAlt")}
                    priority
                    className="rounded-t-md object-cover object-top max-lg:aspect-[4/3] lg:h-full"
                  />
                </div>
              </div>
            </Container>
            <div className="bg-mk-plank h-3" />
          </>
        }
      />

      <Section>
        <Container>
          {/* The form above comes first in the DOM, so phones reach it first. From 861px the
              addresses stand back in the left column, the pictures on the right. */}
          <div className="grid grid-cols-1 gap-x-[clamp(24px,5vw,72px)] gap-y-9 min-[861px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <Reveal>
                <h2 className="font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
                  {t("channelsTitle")}
                </h2>
                <p className="text-mk-text-body mt-4 max-w-[44ch] text-[17px] leading-relaxed text-pretty">
                  <strong className="text-mk-text-strong font-semibold">
                    {t("basedTitle")}.
                  </strong>{" "}
                  {t("basedBody")}
                </p>
              </Reveal>
              <ul className="mt-8 flex flex-col gap-7">
                {CHANNELS.map((key) => (
                  <li key={key}>
                    <h3 className="font-mk-heading text-mk-text-strong text-[22px] leading-[1.25] font-normal">
                      {t(`${key}Title`)}
                    </h3>
                    <a
                      href={`mailto:${t(`${key}Value`)}`}
                      className="text-mk-text-strong mt-1 inline-block text-[17px] font-semibold underline underline-offset-3"
                    >
                      {t(`${key}Value`)}
                    </a>
                    <p className="text-mk-text-body mt-1 text-[17px] leading-normal">
                      {t(`${key}Sub`)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div>
                <Art
                  src={canalBoat}
                  width={480}
                  height={360}
                  alt={t("channelsArtAlt")}
                  className="max-w-[480px] rounded-md"
                />
              </div>
              <div className="mt-[clamp(32px,4vw,56px)]">
                <Art
                  src={floorLiving}
                  width={1129}
                  height={292}
                  alt={t("livingArtAlt")}
                  className="min-h-[170px] max-w-[1129px] rounded-md object-cover"
                />
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </main>
  );
}

type Subject = "swap" | "account" | "idea" | "other";
const SUBJECTS: Subject[] = ["swap", "account", "idea", "other"];
const SUBJECT_KEY: Record<Subject, string> = {
  swap: "subjectSwap",
  account: "subjectAccount",
  idea: "subjectIdea",
  other: "subjectOther",
};

function ContactForm() {
  const t = useTranslations("marketing.contactPage");
  const locale = useLocale();
  const submitMessage = useMutation({
    mutationFn: useConvexMutation(gateway.contact.submit),
  });

  const [form, setForm] = React.useState({
    name: "",
    email: "",
    subject: "swap" as Subject,
    message: "",
  });
  const [errors, setErrors] = React.useState<{
    name?: string;
    email?: string;
    message?: string;
    submit?: React.ReactNode;
  }>({});
  const [sent, setSent] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const messageRef = React.useRef<HTMLTextAreaElement>(null);
  const sentHeadingRef = React.useRef<HTMLHeadingElement>(null);

  const set =
    (k: "name" | "email" | "message") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors((er) => ({ ...er, [k]: undefined, submit: undefined }));
    };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: typeof errors = {};
    if (!form.name.trim()) er.name = t("errorName");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email))
      er.email = t("errorEmail");
    if (form.message.trim().length < 10) er.message = t("errorMessage");
    // Commit the errors before moving focus, so the field a screen reader
    // announces already points at its error through aria-describedby.
    flushSync(() => setErrors(er));
    const firstInvalid = er.name
      ? nameRef
      : er.email
        ? emailRef
        : er.message
          ? messageRef
          : null;
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }

    try {
      await submitMessage.mutateAsync({
        name: form.name,
        email: form.email,
        subject: form.subject,
        message: form.message,
        locale: locale === "nl" ? "nl" : "en",
      });
      // The form (and the focused button) unmounts: land on the confirmation.
      flushSync(() => setSent(true));
      sentHeadingRef.current?.focus();
    } catch (error) {
      const code = convexErrorCode(error);
      // The server's address rule is stricter than the shape check above; name the field it
      // refused rather than suggesting a retry, the same way that check does.
      if (code === "invalid_email") {
        flushSync(() => setErrors({ email: t("errorEmail") }));
        emailRef.current?.focus();
        return;
      }
      // The deployment-wide budget is spent: point at the inbox the form feeds.
      const email = t("emailValue");
      setErrors({
        submit:
          code === "RateLimited"
            ? t.rich("errorBusy", {
                email,
                mail: (chunks) => (
                  <a href={`mailto:${email}`} className="underline">
                    {chunks}
                  </a>
                ),
              })
            : t("errorSubmit"),
      });
    }
  };

  const drawerCls =
    "bg-mk-card rounded-t-md p-[clamp(20px,3vw,40px)] max-lg:rounded-md lg:h-full";
  const labelCls =
    "block text-[16px] font-semibold text-mk-text-strong mb-[7px]";
  const errCls = "text-[16px] text-mk-danger mt-1.5";

  if (sent) {
    return (
      <div className={drawerCls}>
        <h2
          ref={sentHeadingRef}
          tabIndex={-1}
          className="font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] outline-none"
        >
          {t("sentTitle")}
        </h2>
        <p className="text-mk-text-body mt-3 max-w-[52ch] text-[17px] leading-relaxed">
          {t("sentBody")}
        </p>
        <Button
          variant="outline"
          className="bg-mk-card border-mk-input-border text-mk-text-strong hover:bg-mk-muted mt-6"
          onClick={() => {
            flushSync(() => {
              setSent(false);
              setForm({ name: "", email: "", subject: "swap", message: "" });
            });
            nameRef.current?.focus();
          }}
        >
          {t("sentAgain")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={drawerCls}>
      <h2 className="font-mk-heading text-mk-text-strong mb-6 text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em] text-balance">
        {t("formTitle")}
      </h2>
      <div className="grid grid-cols-2 gap-[18px] max-[860px]:grid-cols-1">
        <div>
          <label htmlFor="contact-name" className={labelCls}>
            {t("formName")}
          </label>
          <Input
            ref={nameRef}
            id="contact-name"
            autoComplete="name"
            placeholder={t("formNamePlaceholder")}
            value={form.name}
            onChange={set("name")}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
            className={cn("text-[16px]", errors.name && "border-mk-danger")}
          />
          {errors.name && (
            <div id="contact-name-error" className={errCls}>
              {errors.name}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="contact-email" className={labelCls}>
            {t("formEmail")}
          </label>
          <Input
            ref={emailRef}
            id="contact-email"
            type="email"
            autoComplete="email"
            placeholder={t("formEmailPlaceholder")}
            value={form.email}
            onChange={set("email")}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
            className={cn("text-[16px]", errors.email && "border-mk-danger")}
          />
          {errors.email && (
            <div id="contact-email-error" className={errCls}>
              {errors.email}
            </div>
          )}
        </div>
      </div>
      {/* Native radios (visually hidden, chips are their labels) give the
          subject a checked state, the "Subject" group name and arrow keys. */}
      <fieldset className="mt-[18px]">
        <legend className={labelCls}>{t("formSubject")}</legend>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map((k) => (
            <label
              key={k}

              className={cn(
                "relative cursor-pointer rounded-md border px-3.5 py-2 text-[16px] font-medium transition-[background-color,color,transform] duration-150 ease-mk-out motion-safe:active:scale-[0.97]",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-mk-ring",
                form.subject === k
                  ? "border-mk-canal bg-mk-canal text-mk-on-canal dark:border-mk-ring dark:bg-mk-ring dark:text-mk-canal"
                  : "border-mk-input-border bg-mk-card text-mk-text-body hover:bg-mk-muted",
              )}
            >
              <input
                type="radio"
                name="contact-subject"
                value={k}
                checked={form.subject === k}
                onChange={() => setForm((f) => ({ ...f, subject: k }))}
                className="sr-only"
              />
              {t(SUBJECT_KEY[k])}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-[18px]">
        <label htmlFor="contact-message" className={labelCls}>
          {t("formMessage")}
        </label>
        <textarea
          ref={messageRef}
          id="contact-message"
          rows={6}
          value={form.message}
          onChange={set("message")}
          placeholder={t("formMessagePlaceholder")}
          aria-invalid={!!errors.message}
          aria-describedby={
            errors.message ? "contact-message-error" : undefined
          }
          className={cn(
            "bg-mk-card text-mk-text-body placeholder:text-mk-text-muted w-full resize-y rounded-md border px-[13px] py-[11px] text-[16px] outline-none",
            "focus-visible:border-mk-ring focus-visible:ring-mk-ring/40 focus-visible:ring-[3px]",
            errors.message ? "border-mk-danger" : "border-mk-input-border",
          )}
        />
        {errors.message && (
          <div id="contact-message-error" className={errCls}>
            {errors.message}
          </div>
        )}
      </div>
      {errors.submit && (
        <div role="alert" className={errCls}>
          {errors.submit}
        </div>
      )}
      <Button
        type="submit"
        variant="brand"
        size="public"
        disabled={submitMessage.isPending}
        className="mt-[22px] w-full"
      >
        {t("submit")}
      </Button>
      <p className="text-mk-text-muted mt-3.5 text-[16px] leading-normal">
        {t.rich("privacyNote", {
          link: (chunks) => (
            <Link
              to="/privacy"
              className="text-mk-text-strong font-medium underline underline-offset-3 hover:no-underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}
