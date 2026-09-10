import { NextResponse } from "next/server";
import { destroySession } from "@/server/session";

export async function POST() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
