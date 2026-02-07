import { NextResponse } from "next/server";
import { startOrContinue } from "@/lib/engine";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const formId = searchParams.get("formId") || "demo";
  const result = startOrContinue(formId);
  return NextResponse.json(result);
}
