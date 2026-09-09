import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./console.css";
import VersionWatcher from "@/components/VersionWatcher";

/** Display + data faces for the fee ledger. Kept local to this route so the
 *  storefront and admin keep their own type stack. */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fee ledger — Inventre",
  robots: { index: false, follow: false },
};

export default function FeesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.variable} ${plexMono.variable}`}>
      {/* Covers the ledger, the receipt documents and the access manager: a
          deploy should not need anyone to be told to hard-refresh. */}
      <VersionWatcher className="fx-update" />
      {children}
    </div>
  );
}
