import { SaleStrip } from "@/components/SaleStrip";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ContactHero } from "@/components/contact/ContactHero";
import { ContactForm } from "@/components/contact/ContactForm";
import { FAQ } from "@/components/contact/FAQ";
import { FinalCTA } from "@/components/FinalCTA";
import { resolveMedia } from "@/server/repos/media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact — Inventre",
  description:
    "Reach Inventre — separate channels for parents, schools and business partnerships. Typical response within 24 hours.",
};

export default async function ContactPage() {
  const [parent, school, business] = await Promise.all([
    resolveMedia("media.contact.hero.image_parent"),
    resolveMedia("media.contact.hero.image_school"),
    resolveMedia("media.contact.hero.image_business"),
  ]);
  return (
    <main>
      <SaleStrip />
      <Nav />
      <ContactHero media={{ parent, school, business }} />
      <ContactForm />
      <FAQ />
      <div className="pt-8 lg:pt-12" />
      <FinalCTA />
      <Footer />
    </main>
  );
}
