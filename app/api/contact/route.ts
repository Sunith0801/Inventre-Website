import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { contactSubmissions } from "@/db/schema";
import { rateLimit } from "@/server/rate-limit";

const Body = z.object({
  kind: z.enum(["parent", "school", "business"]),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().regex(/^\d{10}$/),
  organization: z.string().optional(),
  interest: z.string().optional(),
  board: z.string().optional(),
  businessType: z.string().optional(),
  address: z.string().optional(),
  gst: z.string().optional(),
  message: z.string().optional(),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const rl = await rateLimit({
    key: `contact:${ip}`,
    max: 10,
    windowSeconds: 60 * 60,
  });
  if (!rl.ok)
    return NextResponse.json(
      { error: "Too many submissions. Try later." },
      { status: 429 }
    );

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Please complete all required fields" },
      { status: 400 }
    );
  }

  await db.insert(contactSubmissions).values({
    kind: body.kind,
    name: body.name,
    email: body.email,
    phone: body.phone,
    payload: {
      organization: body.organization,
      interest: body.interest,
      board: body.board,
      businessType: body.businessType,
      address: body.address,
      gst: body.gst,
      message: body.message,
    },
  });

   
  console.log(
    `\n📬 New ${body.kind.toUpperCase()} contact: ${body.name} <${body.email}> +91${body.phone}`
  );
  return NextResponse.json({ ok: true });
}
