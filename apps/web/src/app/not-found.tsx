import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Header } from "./_components/header";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <>
      <Header />
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader className="space-y-4">
            <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center">
              <TriangleAlert className="w-12 h-12 text-muted-foreground" />
            </div>
            <CardTitle className="text-3xl font-bold">{t("title")}</CardTitle>
            <CardDescription className="text-lg">
              {t("description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{t("message")}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild>
                <Link href="/">{t("backToHome")}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/browse">{t("browsePuzzles")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
