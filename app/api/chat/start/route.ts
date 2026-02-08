import { NextResponse } from "next/server";
import { startOrContinue } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const formId = (body as any)?.formId ?? "demo";
  const candidateToken = (body as any)?.candidateToken ?? null;

  // For now we just pass through to engine.
  // If you later bind sessions to candidateToken (recommended),
  // you’ll store { sessionId, candidateToken } server-side here.
  const result = startOrContinue(formId);

  return NextResponse.json({
    ...result,
    candidateToken, // echo back so client can keep it (optional but helpful)
  });
}

