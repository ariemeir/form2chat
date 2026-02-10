import { NextResponse } from "next/server";
import { handleUserMessage, RecoveryState } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const { formId, sessionId, text, candidateToken, fieldIndex, answersJson } = body || {};

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
    hasRecovery: fieldIndex !== undefined,
    ts: new Date().toISOString(),
  });

  // Build recovery state from client-provided session state.
  // This allows the engine to recover if the SQLite session was lost
  // (e.g. different Vercel lambda instance, deploy, etc.)
  let recoveryState: RecoveryState | undefined;
  if (typeof fieldIndex === "number" && answersJson) {
    recoveryState = { fieldIndex, answersJson };
  }

  const result = handleUserMessage(formId, sessionId, String(text ?? ""), recoveryState);
  return NextResponse.json(result);
}

