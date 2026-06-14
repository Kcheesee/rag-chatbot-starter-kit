import type { ReactNode } from "react";
import type { Metadata } from "next";

import { getEnv } from "@/lib/pipeline";

import "./globals.css";

export const metadata: Metadata = {
  title: "RAG Chat Agent",
  description: "A production-ready, config-driven RAG chatbot.",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  // A11Y_MODE forces reduced motion app-wide (see globals.css). Reading validated env
  // here is safe at build time — env validation needs no API keys.
  const a11yMode = getEnv().A11Y_MODE;
  return (
    <html lang="en" {...(a11yMode ? { "data-a11y-mode": "true" } : {})}>
      <body>{children}</body>
    </html>
  );
}
