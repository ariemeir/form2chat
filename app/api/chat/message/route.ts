import { NextResponse } from "next/server";
import { handleUserMessage } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const { formId, sessionId, text, candidateToken } = body || {};

  if (!formId || !sessionId) {
    return NextResponse.json(
      { error: "Missing formId or sessionId" },
      { status: 400 }
    );
  }

  console.log("API /chat/message", {
    formId,
    sessionId,
    text,
    hasCandidateToken: !!candidateToken,
    ts: new Date().toISOString(),
  });

  const result = handleUserMessage(formId, sessionId, String(text ?? ""));
  return NextResponse.json(result);
}

