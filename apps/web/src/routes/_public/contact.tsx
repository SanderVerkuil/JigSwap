import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
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
import { LifeBuoy, Mail, MapPin, Shield } from "lucide-react";
import * as React from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/contact")({
  head: ({ match }) => seoHead(match, "contact"),
  component: ContactPage,
});

const CHANNELS = [
  { icon: Mail, key: "email" },
  { icon: LifeBuoy, key: "support" },
  { icon: Shield, key: "privacy" },
] as const;

// Contact: the form + channel list. Submissions persist via the public
// gateway.contact.submit mutation (admin triage), not a fake success state.
function ContactPage() {
  const t = useTranslations("marketing.contactPage");
  return (
    <main id={MAIN_CONTENT_ID}>
      <PageHero
        eyebrow={t("heroEyebrow")}
        title={t("heroTitle")}
        lead={t("heroLead")}
      />

      <Section>
        <Container>
          {/* The form comes first in the DOM, so on phones (one column) it
              starts right under the hero and is reached first. From 861px the
              grid puts the channel list back in the left column. */}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] max-[860px]:grid-cols-1 gap-[clamp(32px,5vw,64px)] items-start">
            <Reveal
              delay={120}
              className="min-[861px]:col-start-2 min-[861px]:row-start-1"
            >
              <ContactForm />
            </Reveal>
            <Reveal className="min-[861px]:col-start-1 min-[861px]:row-start-1">
              <div className="flex flex-col gap-2">
                {CHANNELS.map(({ icon: Icon, key }, i) => (
                  <div
                    key={key}
                    className={cn(
                      "py-[18px]",
                      i < CHANNELS.length - 1 && "border-b border-mk-border",
                    )}
                  >
                    <div className="flex items-center gap-[9px]">
                      <Icon size={17} className="text-mk-violet-600" />
                      <span className="font-mk-heading font-semibold text-base text-mk-text-strong whitespace-nowrap">
                        {t(`${key}Title`)}
                      </span>
                    </div>
                    <a
                      href={`mailto:${t(`${key}Value`)}`}
                      className="block text-[15.5px] text-mk-violet-600 mt-1.5 font-medium hover:underline"
                    >
                      {t(`${key}Value`)}
                    </a>
                    <div className="text-sm text-mk-text-muted mt-1">
                      {t(`${key}Sub`)}
                    </div>
                  </div>
                ))}
                <div className="mt-4 px-[22px] py-5 rounded-[20px] bg-mk-muted border border-mk-border">
                  <div className="flex items-center gap-2.5 font-semibold text-mk-text-strong text-[15px]">
                    <MapPin size={18} className="text-mk-violet-600" />
                    {t("basedTitle")}
                  </div>
                  <p className="text-sm text-mk-text-muted mt-2 leading-relaxed">
                    {t("basedBody")}
                  </p>
                </div>
              </div>
            </Reveal>
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

  const labelCls =
    "block text-[13.5px] font-semibold text-mk-text-strong mb-[7px]";
  const errCls = "text-[12.5px] text-mk-danger mt-1.5";

  if (sent) {
    return (
      <div className="px-9 py-11 rounded-[20px] bg-mk-card border border-mk-border text-center shadow-mk-sm">
        <div aria-hidden="true" className="text-[44px]">
          🧩
        </div>
        <h2
          ref={sentHeadingRef}
          tabIndex={-1}
          className="font-mk-heading font-bold tracking-tight text-2xl text-mk-text-strong mt-3 outline-none"
        >
          {t("sentTitle")}
        </h2>
        <p className="text-[15.5px] text-mk-text-muted mt-2.5 leading-relaxed">
          {t("sentBody")}
        </p>
        <Button
          variant="outline"
          className="mt-[22px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
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
    <form
      onSubmit={submit}
      noValidate
      className="px-8 pt-8 pb-[34px] rounded-[20px] bg-mk-card border border-mk-border shadow-mk-sm"
    >
      <div className="grid grid-cols-2 max-[860px]:grid-cols-1 gap-[18px]">
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
            className={errors.name ? "border-mk-danger" : ""}
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
            className={errors.email ? "border-mk-danger" : ""}
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
                "relative cursor-pointer px-3.5 py-2 rounded-full text-[13.5px] font-medium border transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-mk-ring",
                form.subject === k
                  ? "border-mk-violet-400 bg-mk-violet-50 text-mk-violet-600"
                  : "border-mk-border bg-mk-card text-mk-text-body hover:bg-mk-muted",
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
          rows={5}
          value={form.message}
          onChange={set("message")}
          placeholder={t("formMessagePlaceholder")}
          aria-invalid={!!errors.message}
          aria-describedby={
            errors.message ? "contact-message-error" : undefined
          }
          className={cn(
            "w-full resize-y text-base md:not-pointer-coarse:text-[15px] px-[13px] py-[11px] rounded-[10px] border bg-mk-card text-mk-text-body outline-none",
            "focus:[box-shadow:0_0_0_3px_rgb(96_72_232_/_.18)]",
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
        disabled={submitMessage.isPending}
        className="mt-[22px] w-full h-11 text-[15px]"
      >
        {t("submit")}
      </Button>
      <p className="text-[12.5px] text-mk-text-muted mt-3.5 text-center leading-normal">
        {t.rich("privacyNote", {
          link: (chunks) => (
            <Link
              to="/privacy"
              className="font-medium text-mk-violet-600 underline underline-offset-2 hover:no-underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}
