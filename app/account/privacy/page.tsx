"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";
import { YourDataCard } from "@/components/account/YourDataCard";

/**
 * /account/privacy — the parent's data-rights page (DPDP s.11–13): download
 * a copy of everything we hold, or request deletion. Reached from the small
 * "Privacy & your data" link at the foot of /account and from the privacy
 * notice. Deliberately off the main account page: rarely used, legally
 * required.
 */
export default function AccountPrivacyPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    auth
      .me()
      .then(setMe)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!me) router.push("/login");
    else if (me.kind !== "parent") router.push("/admin");
  }, [loaded, me, router]);

  if (!loaded || !me || me.kind !== "parent") return null;

  return (
    <main className="min-h-screen bg-cream-50 pb-20">
      <Nav />
      <div className="mx-auto max-w-2xl px-4 pt-8">
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to account
        </Link>
        <h1 className="mt-4 font-display text-[26px] font-bold text-ink-900">Privacy &amp; your data</h1>
        <p className="mt-1 text-[14px] text-ink-600">
          Your rights under the Digital Personal Data Protection Act 2023. Read the full{" "}
          <Link href="/privacy" className="text-brand underline">
            privacy notice
          </Link>
          .
        </p>
        <YourDataCard />
      </div>
      <Footer />
    </main>
  );
}
