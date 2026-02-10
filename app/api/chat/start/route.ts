import { NextResponse } from "next/server";
import { startOrContinue } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const formId = (body as any)?.formId;

  if (!formId) {
    return NextResponse.json(
      { error: "missing_formId" },
      { status: 400 }
  );
  }

  const candidateToken = (body as any)?.candidateToken ?? null;
  const targetCount = typeof (body as any)?.targetCount === "number" ? (body as any).targetCount : undefined;

  const result = startOrContinue(formId, undefined, targetCount ? { targetCount } : undefined);

  return NextResponse.json({
    ...result,
    candidateToken, // echo back so client can keep it (optional but helpful)
  });
}

