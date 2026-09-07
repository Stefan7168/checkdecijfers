// Session 87 visual redesign: light/dark via next-themes. `attribute="class"`
// puts `.dark` on <html>, which is what the shadcn token layer in
// app/globals.css keys on. Mounted once in app/layout.tsx.
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange {...props}>
      {children}
    </NextThemesProvider>
  );
}
