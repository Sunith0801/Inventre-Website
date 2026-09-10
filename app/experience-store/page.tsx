import { SaleStrip } from "@/components/SaleStrip";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ExperienceHero } from "@/components/experience/ExperienceHero";
import { StoreSneakPeek } from "@/components/experience/StoreSneakPeek";
import { VisitInfo } from "@/components/experience/VisitInfo";
import { StoreMap } from "@/components/experience/StoreMap";
import { FinalCTA } from "@/components/FinalCTA";
import { resolveMedia } from "@/server/repos/media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Experience Store — Inventre",
  description:
    "Inventre Experience Store, Ashoka One Mall, Hyderabad. Try uniforms, see the Magic Box, and meet the team.",
};

export default async function ExperienceStorePage() {
  const [backdrop, sneak1, sneak2, sneak3, sneak4, sneak5] = await Promise.all([
    resolveMedia("media.experience.hero.image"),
    resolveMedia("media.experience.sneak_peek.image_1"),
    resolveMedia("media.experience.sneak_peek.image_2"),
    resolveMedia("media.experience.sneak_peek.image_3"),
    resolveMedia("media.experience.sneak_peek.image_4"),
    resolveMedia("media.experience.sneak_peek.image_5"),
  ]);
  return (
    <main>
      <SaleStrip />
      <Nav />
      <ExperienceHero media={{ backdrop }} />
      <StoreSneakPeek
        media={{ image1: sneak1, image2: sneak2, image3: sneak3, image4: sneak4, image5: sneak5 }}
      />
      <VisitInfo />
      <StoreMap />
      <div className="pt-16 lg:pt-20" />
      <FinalCTA />
      <Footer />
    </main>
  );
}
