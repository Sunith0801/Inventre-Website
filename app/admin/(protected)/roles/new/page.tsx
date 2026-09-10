import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission, isResponse } from "@/server/admin-guard";
import { ADMIN_PAGES, ADMIN_PERMISSION_GROUPS } from "@/lib/admin-permissions";
import { RoleEditor } from "@/components/admin/RoleEditor";

export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const guard = await requirePermission("roles.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  return (
    <div className="max-w-4xl">
      <Link href="/admin/roles" className="text-[12.5px] text-ink-500 hover:text-ink-900 inline-flex items-center gap-1">
        <ChevronLeft className="h-3 w-3" /> All roles
      </Link>
      <RoleEditor
        role={null}
        pages={ADMIN_PAGES}
        groups={[...ADMIN_PERMISSION_GROUPS]}
        granted={[]}
      />
    </div>
  );
}
