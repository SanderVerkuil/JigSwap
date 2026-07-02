import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/admin/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "admin") }],
  }),
  component: AdminDashboardPage,
});

// The admin landing page: one card per admin surface (categories, moderation,
// contact triage, docs feedback), each linking into its section.
const SECTIONS = [
  { key: "categories", href: "/admin/categories" },
  { key: "moderation", href: "/admin/moderation" },
  { key: "contact", href: "/admin/contact" },
  { key: "docFeedback", href: "/admin/feedback" },
] as const;

function AdminDashboardPage() {
  const t = useTranslations("admin.dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground mt-2">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {SECTIONS.map((section) => (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle>{t(`${section.key}.title`)}</CardTitle>
              <CardDescription>
                {t(`${section.key}.description`)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={section.href}>{t(`${section.key}.cta`)}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
