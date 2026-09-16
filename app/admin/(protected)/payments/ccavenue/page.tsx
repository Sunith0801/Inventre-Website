import { redirect } from "next/navigation";

/** The CCAvenue log is the first tab of Payments now; old bookmarks land there. */
export default async function LegacyCcavenueLogs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) qs.set(k, v);
  const s = qs.toString();
  redirect(s ? `/admin/payments?${s}` : "/admin/payments");
}
