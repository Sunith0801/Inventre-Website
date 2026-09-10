import { readSupportView } from "@/server/support-view";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { SupportViewBannerClient } from "./SupportViewBanner.client";

/**
 * Server half: reads the support-view cookie, resolves the impersonated
 * parent's name/phone and the acting agent, then hands off to the client
 * banner for the live countdown + expiry redirect. Renders nothing unless a
 * valid support-view cookie is present.
 */
export async function SupportViewBanner() {
  const view = await readSupportView();
  if (!view) return null;

  let parentName = view.parentId.slice(0, 8);
  let parentPhone = "";
  try {
    const [p] = await db
      .select({ name: parents.name, phone: parents.phone })
      .from(parents)
      .where(eq(parents.id, view.parentId))
      .limit(1);
    if (p) {
      parentName = p.name ?? "(unnamed)";
      parentPhone = p.phone ?? "";
    }
  } catch {
    // banner is best-effort; never fail layout if DB hiccups
  }

  const agentLabel = view.agentName?.trim() || view.agentId.slice(0, 8);

  return (
    <SupportViewBannerClient
      agentLabel={agentLabel}
      parentName={parentName}
      parentPhone={parentPhone}
      expMs={view.exp * 1000}
    />
  );
}
