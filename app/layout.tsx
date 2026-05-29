import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AuthGate } from "@/components/auth/AuthGate";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inventre — Your child's school kit. One box. Delivered.",
  description:
    "End-to-end school essentials, branded for your school and delivered to your door. Trusted by 40+ schools and 20,000+ students across India.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="font-sans bg-cream text-ink-900 antialiased">
        <AuthGate />
        {children}
      </body>
    </html>
  );
}
