import { NextResponse } from "next/server";
import { startOrContinue } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const formId = (body as any)?.formId ?? "demo";
  const result = startOrContinue(formId);
  return NextResponse.json(result);
}

