import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") redirect("/admin/login");
  return <AdminShell user={me}>{children}</AdminShell>;
}
