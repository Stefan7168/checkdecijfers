import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Check de Cijfers",
  description: "Chat met officiële CBS-cijfers — elk getal herleidbaar tot een CBS-tabel.",
  // Phase 0: internal/testing deployment on a *.vercel.app subdomain, not the
  // public launch (docs/03-mvp-scope.md — browse pages/SEO are a later
  // phase; the checkdecijfers.nl domain isn't even confirmed yet per
  // RUNBOOK.md). Remove this when the real public launch is ready.
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="nl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
