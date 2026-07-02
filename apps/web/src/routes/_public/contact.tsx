import { createFileRoute } from "@tanstack/react-router";

import { pageTitle } from "@/lib/page-title";

import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { LifeBuoy, Mail, MapPin, Shield } from "lucide-react";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/contact")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "contact") }],
  }),
  component: ContactPage,
});

const CHANNELS = [
  { icon: Mail, key: "email" },
  { icon: LifeBuoy, key: "support" },
  { icon: Shield, key: "privacy" },
] as const;

// Contact: channel list + the form. Submissions persist via the public
// gateway.contact.submit mutation (admin triage), not a fake success state.
function ContactPage() {
  const t = useTranslations("marketing.contactPage");
  return (
    <main>
      <PageHero
        eyebrow={t("heroEyebrow")}
        title={t("heroTitle")}
        lead={t("heroLead")}
      />

      <Section>
        <Container>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] max-[860px]:grid-cols-1 gap-[clamp(32px,5vw,64px)] items-start">
            <Reveal>
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
            <Reveal delay={120}>
              <ContactForm />
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
    submit?: string;
  }>({});
  const [sent, setSent] = React.useState(false);

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
    setErrors(er);
    if (Object.keys(er).length > 0) return;

    try {
      await submitMessage.mutateAsync({
        name: form.name,
        email: form.email,
        subject: form.subject,
        message: form.message,
        locale,
      });
      setSent(true);
    } catch {
      setErrors({ submit: t("errorSubmit") });
    }
  };

  const labelCls =
    "block text-[13.5px] font-semibold text-mk-text-strong mb-[7px]";
  const errCls = "text-[12.5px] text-mk-danger mt-1.5";

  if (sent) {
    return (
      <div className="px-9 py-11 rounded-[20px] bg-mk-card border border-mk-border text-center shadow-mk-sm">
        <div className="text-[44px]">🧩</div>
        <h3 className="font-mk-heading font-bold tracking-tight text-2xl text-mk-text-strong mt-3">
          {t("sentTitle")}
        </h3>
        <p className="text-[15.5px] text-mk-text-muted mt-2.5 leading-relaxed">
          {t("sentBody")}
        </p>
        <Button
          variant="outline"
          className="mt-[22px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
          onClick={() => {
            setSent(false);
            setForm({ name: "", email: "", subject: "swap", message: "" });
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
            id="contact-name"
            placeholder={t("formNamePlaceholder")}
            value={form.name}
            onChange={set("name")}
            aria-invalid={!!errors.name}
            className={errors.name ? "border-mk-danger" : ""}
          />
          {errors.name && <div className={errCls}>{errors.name}</div>}
        </div>
        <div>
          <label htmlFor="contact-email" className={labelCls}>
            {t("formEmail")}
          </label>
          <Input
            id="contact-email"
            type="email"
            placeholder={t("formEmailPlaceholder")}
            value={form.email}
            onChange={set("email")}
            aria-invalid={!!errors.email}
            className={errors.email ? "border-mk-danger" : ""}
          />
          {errors.email && <div className={errCls}>{errors.email}</div>}
        </div>
      </div>
      <div className="mt-[18px]">
        <span className={labelCls}>{t("formSubject")}</span>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setForm((f) => ({ ...f, subject: k }))}
              className={cn(
                "cursor-pointer px-3.5 py-2 rounded-full text-[13.5px] font-medium border transition-colors",
                form.subject === k
                  ? "border-mk-violet-400 bg-mk-violet-50 text-mk-violet-600"
                  : "border-mk-border bg-mk-card text-mk-text-body hover:bg-mk-muted",
              )}
            >
              {t(SUBJECT_KEY[k])}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-[18px]">
        <label htmlFor="contact-message" className={labelCls}>
          {t("formMessage")}
        </label>
        <textarea
          id="contact-message"
          rows={5}
          value={form.message}
          onChange={set("message")}
          placeholder={t("formMessagePlaceholder")}
          aria-invalid={!!errors.message}
          className={cn(
            "w-full resize-y text-[15px] px-[13px] py-[11px] rounded-[10px] border bg-mk-card text-mk-text-body outline-none",
            "focus:[box-shadow:0_0_0_3px_rgb(96_72_232_/_.18)]",
            errors.message ? "border-mk-danger" : "border-mk-input-border",
          )}
        />
        {errors.message && <div className={errCls}>{errors.message}</div>}
      </div>
      {errors.submit && <div className={errCls}>{errors.submit}</div>}
      <Button
        type="submit"
        variant="brand"
        disabled={submitMessage.isPending}
        className="mt-[22px] w-full h-11 text-[15px]"
      >
        {t("submit")}
      </Button>
      <p className="text-[12.5px] text-mk-text-muted mt-3.5 text-center leading-normal">
        {t("privacyNote")}
      </p>
    </form>
  );
}
