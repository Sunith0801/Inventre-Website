import { SaleStrip } from "@/components/SaleStrip";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { AboutHero } from "@/components/about/AboutHero";
import { FounderStory } from "@/components/about/FounderStory";
import { ProcessTimeline } from "@/components/about/ProcessTimeline";
import { Innovations } from "@/components/about/Innovations";
import { VisionMission } from "@/components/about/VisionMission";
import { Sustainability } from "@/components/about/Sustainability";
import { FinalCTA } from "@/components/FinalCTA";
import { resolveMedia } from "@/lib/repos/media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "About — Inventre",
  description:
    "Inventre — your school's brand-insignia partner. End-to-end uniforms, books, and essentials with one trusted system.",
};

export default async function AboutPage() {
  // Server-side fetch admin-managed media URLs; each falls back to its
  // hard-coded default automatically (see lib/media-slots.ts).
  const [
    heroImage1,
    heroImage2,
    innovationsMagicBox,
    innovationsQuality1,
    innovationsQuality2,
    founderVideo1,
    founderVideo2,
  ] = await Promise.all([
    resolveMedia("media.about.hero.image_1"),
    resolveMedia("media.about.hero.image_2"),
    resolveMedia("media.about.innovations.magic_box_video"),
    resolveMedia("media.about.innovations.quality_image_1"),
    resolveMedia("media.about.innovations.quality_image_2"),
    resolveMedia("media.about.founder.video_1"),
    resolveMedia("media.about.founder.video_2"),
  ]);

  return (
    <main>
      <SaleStrip />
      <Nav />
      <AboutHero media={{ image1: heroImage1, image2: heroImage2 }} />
      <FounderStory media={{ video1: founderVideo1, video2: founderVideo2 }} />
      <ProcessTimeline />
      <Innovations
        media={{
          magicBoxVideo: innovationsMagicBox,
          qualityImage1: innovationsQuality1,
          qualityImage2: innovationsQuality2,
        }}
      />
      <VisionMission />
      <Sustainability />
      <div className="pt-20 lg:pt-28" />
      <FinalCTA />
      <Footer />
    </main>
  );
}
