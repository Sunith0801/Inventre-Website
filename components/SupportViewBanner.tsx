import { readSupportView } from "@/lib/support-view";
import { db } from "@/db/client";
import { parents } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function SupportViewBanner() {
  const view = await readSupportView();
  if (!view) return null;

  let parentLabel = view.parentId.slice(0, 8);
  try {
    const [p] = await db
      .select({ name: parents.name, phone: parents.phone })
      .from(parents)
      .where(eq(parents.id, view.parentId))
      .limit(1);
    if (p) parentLabel = `${p.name ?? "(unnamed)"} · ${p.phone}`;
  } catch {
    // banner is best-effort; never fail layout if DB hiccups
  }

  const endsAt = new Date(view.exp * 1000);
  const endsAtText = endsAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "#dc2626",
        color: "white",
        padding: "8px 12px",
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        display: "flex",
        gap: 16,
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "2px solid #991b1b",
      }}
      role="alert"
    >
      <span>
        <b>AGENT VIEW · READ-ONLY</b> &nbsp; viewing as {parentLabel}
      </span>
      <span style={{ opacity: 0.85 }}>
        agent {view.agentName ?? view.agentId.slice(0, 8)} · session{" "}
        {view.supportSessionId.slice(0, 8)} · ends {endsAtText}
      </span>
    </div>
  );
}
