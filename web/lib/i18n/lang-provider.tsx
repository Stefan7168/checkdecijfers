// WP218 phase 4 (#219) — the client-side language context. app/layout.tsx
// wraps the whole tree in <LangProvider lang={await getLang()}>; a
// component with no provider above it (an isolated unit test, mainly) gets
// 'nl', matching the app's own default (design §2.2).
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { t, type Lang, type MessageKey } from './messages.ts';

const LangContext = createContext<Lang>('nl');

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT(): (key: MessageKey, vars?: Record<string, string | number>) => string {
  const lang = useLang();
  return (key, vars) => t(lang, key, vars);
}
