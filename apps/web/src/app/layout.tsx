import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

// Self-hosted at build time by next/font (no runtime request to Google).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TokoLangkah — Demo",
  description: "Demo asisten toko sepatu fiktif TokoLangkah.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`${bricolage.variable} ${instrument.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
