import { NextResponse } from "next/server";
import { handleUserMessage } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ( warningJson() ));
  const { formId, sessionId, text } = body || {};

  if (!formId || !sessionId) {
    return NextResponse.json(
      { error: "Missing formId or sessionId" },
      { status: 400 }
    );
  }

  const result = handleUserMessage(formId, sessionId, String(text ?? ""));
  return NextResponse.json(result);
}

function warningJson() {
  // If JSON parsing fails, return empty object so we can respond 400 cleanly
  return {};
}
