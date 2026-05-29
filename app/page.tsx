import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SaleStrip } from "@/components/SaleStrip";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Stats } from "@/components/Stats";
import { HowItWorks } from "@/components/HowItWorks";
import { ForSchools } from "@/components/ForSchools";
import { Testimonials } from "@/components/Testimonials";
import { FinalCTA } from "@/components/FinalCTA";
import { Footer } from "@/components/Footer";
import { resolveMedia } from "@/lib/repos/media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Inventre — School Uniforms & Essentials",
  description:
    "School uniforms, books, and essentials — curated for your school, delivered to your door.",
};

export default async function Home() {
  const session = await getSession();
  if (session?.kind === "parent") redirect("/shop");

  const [forSchoolsVideo, heroVideo] = await Promise.all([
    resolveMedia("media.for_schools.magic_box_video"),
    resolveMedia("media.home.hero.video"),
  ]);

  return (
    <main>
      <SaleStrip />
      <Nav />
      <Hero media={{ heroVideo }} />
      <Stats />
      <HowItWorks />
      <ForSchools media={{ magicBoxVideo: forSchoolsVideo }} />
      <Testimonials />
      <FinalCTA />
      <Footer />
    </main>
  );
}
