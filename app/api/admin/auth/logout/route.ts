import { NextResponse } from "next/server";
import { destroyAdminSession } from "@/server/session";

export async function POST() {
  await destroyAdminSession();
  return NextResponse.json({ ok: true });
}
