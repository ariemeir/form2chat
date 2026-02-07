import { NextResponse } from "next/server";
import { submitSession } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const formId = body.formId ?? "demo";
  const sessionId = body.sessionId as string | undefined;

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  return NextResponse.json(submitSession(formId, sessionId));
}
