import { NextResponse } from "next/server";
import { handleUserMessage, startOrContinue } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const formId = body.formId ?? "demo";
  const sessionId = body.sessionId as string | undefined;
  const text = (body.text as string | undefined) ?? "";

  const res = sessionId ? handleUserMessage(formId, sessionId, text) : startOrContinue(formId);
  return NextResponse.json(res);
}
