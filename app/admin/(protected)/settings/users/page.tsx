import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, schools } from "@/db/schema";
import { UserList } from "@/components/admin/UserList";

export default async function AdminUsersPage() {
  const rows = await db
    .select({ user: users, school: schools })
    .from(users)
    .leftJoin(schools, eq(schools.id, users.schoolId))
    .orderBy(asc(users.email));
  const allSchools = await db
    .select({ id: schools.id, name: schools.name })
    .from(schools)
    .orderBy(asc(schools.name));

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        Admin users
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        {rows.length} users with admin access. Roles: super (everything), ops
        (orders + reviews), school_admin (their school only).
      </p>
      <div className="mt-6">
        <UserList
          initial={rows.map(({ user, school }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            schoolId: user.schoolId,
            schoolName: school?.name ?? null,
            status: user.status,
          }))}
          schools={allSchools}
        />
      </div>
    </div>
  );
}
