'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/ui/theme-toggle';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { useTranslations } from 'next-intl';
import { Authenticated, Unauthenticated } from 'convex/react';

export function Header() {
  const t = useTranslations();

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">🧩</span>
          <span className="text-xl font-bold text-primary">JigSwap</span>
        </div>
        <div className="flex items-center space-x-4">
          <LanguageSwitcher />
          <ModeToggle />
          <Unauthenticated>
            <Link href="/sign-in">
              <Button variant="ghost">{t('navigation.signIn')}</Button>
            </Link>
            <Link href="/sign-up">
              <Button variant="default">{t('navigation.signUp')}</Button>
            </Link>
          </Unauthenticated>
          <Authenticated>
            <Link href="/dashboard">
              <Button variant="ghost">{t('navigation.dashboard')}</Button>
            </Link>
          </Authenticated>
        </div>
      </div>
    </header>
  );
}
