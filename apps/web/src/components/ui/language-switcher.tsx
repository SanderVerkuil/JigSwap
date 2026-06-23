import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearIntlCache, type Locale, setLocale } from "@/lib/i18n";
import { useRouter } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

const languages = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "nl", name: "Nederlands", flag: "🇳🇱" },
];

export function LanguageSwitcher() {
  const currentLocale = useLocale();
  const router = useRouter();
  const t = useTranslations("shell.language");

  const handleLanguageChange = async (locale: string) => {
    await setLocale({ data: locale as Locale });
    // Drop the client-side catalog cache, then re-run the root beforeLoad so
    // the IntlProvider picks up the new catalog.
    clearIntlCache();
    await router.invalidate();
    toast.success(t("changed"));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Globe className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">{t("switch")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        {languages.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onClick={() => handleLanguageChange(language.code)}
            className={currentLocale === language.code ? "bg-accent" : ""}
          >
            <span className="mr-2">{language.flag}</span>
            {language.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
