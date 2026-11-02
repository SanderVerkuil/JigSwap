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
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/contact")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "contact") }],
  }),
  component: ContactPage,
});

const CHANNELS = ["email", "support", "privacy"] as const;

// Contact: the form on a white drawer beside the street, then the addresses. Submissions persist via
// the public gateway.contact.submit mutation (admin triage), not a fake success state.
function ContactPage() {
  const t = useTranslations("marketing.contactPage");
  return (
    <main>
      <PageHero
        title={t("heroTitle")}
        lead={t("heroLead")}
        below={
          <>
            <Container>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
                <Reveal delay={100} className="max-lg:order-2">
                  <Art
                    src={streetTall}
                    width={650}
                    height={864}
                    alt={t("artAlt")}
                    className="rounded-t-md object-cover object-top max-lg:aspect-[4/3] lg:h-full"
                  />
                </Reveal>
                <Reveal>
                  <ContactForm />
                </Reveal>
              </div>
            </Container>
            <div className="bg-mk-plank h-3" />
          </>
        }
      />

      <Section>
        <Container>
          <div className="grid grid-cols-1 gap-x-[clamp(24px,5vw,72px)] gap-y-9 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
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
              <Reveal delay={70}>
                <Art
                  src={canalBoat}
                  width={480}
                  height={360}
                  alt={t("channelsArtAlt")}
                  className="mt-8 max-w-[480px] rounded-md"
                />
              </Reveal>
            </div>
            <div>
              <ul className="flex flex-col gap-7">
                {CHANNELS.map((key, i) => (
                  <li key={key}>
                    <Reveal delay={i * 70}>
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
                    </Reveal>
                  </li>
                ))}
              </ul>
              <Reveal className="mt-[clamp(32px,4vw,56px)]">
                <Art
                  src={floorLiving}
                  width={1129}
                  height={292}
                  alt={t("livingArtAlt")}
                  className="min-h-[170px] max-w-[1129px] rounded-md object-cover"
                />
              </Reveal>
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

  const drawerCls =
    "bg-mk-card rounded-t-md p-[clamp(20px,3vw,40px)] max-lg:rounded-md lg:h-full";
  const labelCls =
    "block text-[16px] font-semibold text-mk-text-strong mb-[7px]";
  const errCls = "text-[16px] text-mk-danger mt-1.5";

  if (sent) {
    return (
      <div className={drawerCls}>
        <h2 className="font-mk-heading text-mk-text-strong text-[clamp(28px,3.6vw,44px)] leading-[1.1] font-normal tracking-[-0.01em]">
          {t("sentTitle")}
        </h2>
        <p className="text-mk-text-body mt-3 max-w-[52ch] text-[17px] leading-relaxed">
          {t("sentBody")}
        </p>
        <Button
          variant="outline"
          className="bg-mk-card border-mk-input-border text-mk-text-strong hover:bg-mk-muted mt-6"
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
            id="contact-name"
            placeholder={t("formNamePlaceholder")}
            value={form.name}
            onChange={set("name")}
            aria-invalid={!!errors.name}
            className={cn("text-[16px]", errors.name && "border-mk-danger")}
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
            className={cn("text-[16px]", errors.email && "border-mk-danger")}
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
              aria-pressed={form.subject === k}
              onClick={() => setForm((f) => ({ ...f, subject: k }))}
              className={cn(
                "cursor-pointer rounded-md border px-3.5 py-2 text-[16px] font-medium transition-[background-color,color,transform] duration-150 ease-mk-out motion-safe:active:scale-[0.97]",
                form.subject === k
                  ? "border-mk-canal bg-mk-canal text-mk-on-canal"
                  : "border-mk-input-border bg-mk-card text-mk-text-body hover:bg-mk-muted",
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
          rows={6}
          value={form.message}
          onChange={set("message")}
          placeholder={t("formMessagePlaceholder")}
          aria-invalid={!!errors.message}
          className={cn(
            "bg-mk-card text-mk-text-body placeholder:text-mk-text-muted w-full resize-y rounded-md border px-[13px] py-[11px] text-[16px] outline-none",
            "focus-visible:border-mk-ring focus-visible:ring-mk-ring/40 focus-visible:ring-[3px]",
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
        className="mt-[22px] h-11 w-full text-[16px]"
      >
        {t("submit")}
      </Button>
      <p className="text-mk-text-muted mt-3.5 text-[16px] leading-normal">
        {t("privacyNote")}
      </p>
    </form>
  );
}
