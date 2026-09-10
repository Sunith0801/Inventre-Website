import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { parseJson } from "@/server/api-handler";
import { logAdminActivity } from "@/server/activity";

const Body = z.object({
  schoolCode: z.string().min(1).max(40),
  schoolName: z.string().min(1),
  branchName: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  status: z.enum(["Onboarding", "Active", "Inactive"]).default("Onboarding"),
  schoolLogoUrl: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  uniformDetailsCheckbox: z.boolean().optional(),
  booksDetailsCheckbox: z.boolean().optional(),
});

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// Resolve to a slug that doesn't collide with any existing school. Tries the
// base slug first; on collision appends -2, -3, … up to -99. Returns the
// chosen slug. The race window between this lookup and the insert is closed
// by the unique constraint on schools.slug — the caller still must catch the
// duplicate-key error if it loses the race, but in practice this avoids 99%
// of friction (typos, double-submits, branch resubmits).
async function uniqueSchoolSlug(base: string): Promise<string> {
  const candidates = [base, ...Array.from({ length: 98 }, (_, i) => `${base}-${i + 2}`)];
  const taken = await db
    .select({ slug: schema.schools.slug })
    .from(schema.schools)
    .where(inArray(schema.schools.slug, candidates));
  const takenSet = new Set(taken.map((r) => r.slug));
  for (const s of candidates) if (!takenSet.has(s)) return s;
  return `${base}-${Date.now().toString(36)}`;
}

export async function POST(req: Request) {
  const guard = await requirePermission("schools.write");
  if (isResponse(guard)) return guard;
  const body = await parseJson(req, Body);
  if (body instanceof NextResponse) return body;

  // Reject exact duplicates upfront — a double-click on "Create school"
  // should not silently create a second school with a -2 slug. Match on
  // (schoolCode, schoolName) since slug is derived from both.
  const [dup] = await db
    .select({ id: schema.schools.id })
    .from(schema.schools)
    .where(
      and(
        eq(schema.schools.schoolCode, body.schoolCode),
        eq(schema.schools.schoolName, body.schoolName)
      )
    )
    .limit(1);
  if (dup) {
    return NextResponse.json(
      {
        error: "A school with that code and name already exists.",
        existingId: dup.id,
      },
      { status: 409 }
    );
  }

  // After the full merge there's only ONE schools table — write `name`
  // (storefront-side, NOT NULL) and `schoolName` (display) together. The
  // admin-friendly status maps to the storefront enum; "Onboarding" keeps
  // the school hidden from /shop until an operator promotes it. The
  // -2/-3 slug suffix below covers the rare case of a different school
  // happening to slugify to the same value.
  const baseSlug = slugify(`${body.schoolCode}-${body.schoolName}`);
  const slug = await uniqueSchoolSlug(baseSlug);
  const storefrontStatus =
    body.status === "Inactive"
      ? "paused"
      : body.status === "Onboarding"
        ? "onboarding"
        : "active";

  try {
    const [created] = await db
      .insert(schema.schools)
      .values({
        slug,
        name: body.schoolName,
        schoolCode: body.schoolCode,
        schoolName: body.schoolName,
        branchName: body.branchName ?? null,
        websiteUrl: body.websiteUrl ?? null,
        status: storefrontStatus,
        schoolLogoUrl: body.schoolLogoUrl ?? null,
        street: body.street ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        country: body.country ?? null,
        pincode: body.pincode ?? null,
        uniformDetailsCheckbox: body.uniformDetailsCheckbox ?? false,
        booksDetailsCheckbox: body.booksDetailsCheckbox ?? false,
      })
      .returning({ id: schema.schools.id });
    void logAdminActivity(guard, {
      action: "school.create",
      entityType: "school",
      entityId: created.id,
      summary: `Created school ${body.schoolName} (${body.schoolCode})`,
      req,
    });
    return NextResponse.json({ id: created.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique constraint/i.test(msg)) {
      return NextResponse.json(
        { error: "A school with that code + name already exists." },
        { status: 409 }
      );
    }
    throw err;
  }
}
