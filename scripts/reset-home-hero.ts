import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";

async function main() {
  const realHero = {
    eyebrow: "Now serving 40+ schools across India",
    headlineTop: "Your child's",
    headlineMid: "entire school kit.",
    headlineHighlight: "One box.",
    headlineEnd: "Delivered.",
    sub: "Uniforms, bags, shoes, accessories — every essential, branded by your school and shipped straight to your door. Try before you buy. No vendor chase. No queues.",
    ctaPrimary: "Shop the kit",
    videoUrl: "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/slider_1.mp4",
    videoCaption: "Indus International — first day of term",
  };
  await db
    .update(contentBlocks)
    .set({ data: realHero as never, updatedAt: new Date() })
    .where(eq(contentBlocks.key, "home.hero"));
  console.log("home.hero restored to real homepage content.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
