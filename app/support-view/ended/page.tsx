export const dynamic = "force-dynamic";

/**
 * Landing page for an expired read-only support-view session. The client
 * banner redirects here when the 15-minute token runs out (the cookie/JWT
 * have expired, so the impersonation is already dead by the time this shows).
 * Public — no auth, no support cookie required.
 */
export default async function SupportViewEndedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const exited = (await searchParams).reason === "exit";
  const heading = exited ? "Read-only view closed" : "Read-only session ended";
  const body = exited
    ? "You have exited the view-as-parent session. Your own session is active again in this tab."
    : "This 15-minute view-as-parent session has expired. For the customer’s security, the read-only access is now closed.";
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f8fafc",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: "28px 26px",
          boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 8px 24px rgba(15,23,42,.06)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 34, lineHeight: 1 }}>{exited ? "✅" : "⏱"}</div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: "14px 0 6px",
            color: "#0f172a",
          }}
        >
          {heading}
        </h1>
        <p style={{ color: "#475569", fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>
          {body}
        </p>
        <p
          style={{
            color: "#475569",
            fontSize: 14.5,
            lineHeight: 1.55,
            margin: "12px 0 0",
          }}
        >
          To continue, open a fresh view from the <b>audit panel</b> — it will issue
          a new session. You can close this tab.
        </p>
      </div>
    </main>
  );
}
