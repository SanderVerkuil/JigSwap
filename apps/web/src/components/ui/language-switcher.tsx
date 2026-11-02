import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearIntlCache, setLocale, type Locale } from "@/lib/i18n";
import { useRouter } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

const languages = [
  { code: "en", name: "English" },
  { code: "nl", name: "Nederlands" },
];

export function LanguageSwitcher() {
  const currentLocale = useLocale();
  const router = useRouter();
  const t = useTranslations("shell.language");
  const current = languages.find((language) => language.code === currentLocale);

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
        <Button
          variant="ghost"
          className="relative gap-1.5 px-2.5 has-[>svg]:px-2.5"
        >
          <Globe className="h-[1.2rem] w-[1.2rem]" aria-hidden />
          {currentLocale.toUpperCase()}
          <span className="sr-only">
            {t("switch")}.{" "}
            {t("current", { language: current?.name ?? currentLocale })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentLocale}
          onValueChange={handleLanguageChange}
        >
          {languages.map((language) => (
            <DropdownMenuRadioItem
              key={language.code}
              value={language.code}
              lang={language.code}
            >
              {language.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
