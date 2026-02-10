import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPABASE_FN =
  "https://cqrtlfgnsmvkfngmdctm.supabase.co/functions/v1/get-candidate-by-token";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const candidateToken = body?.candidate_token;

    if (!candidateToken || typeof candidateToken !== "string") {
      return NextResponse.json({ error: "Missing candidate_token" }, { status: 400 });
    }

    const anonKey = process.env.LOVEABLE_ANON_KEY;
    if (!anonKey) {
      return NextResponse.json({ error: "Server misconfiguration: missing API key" }, { status: 500 });
    }

    const resp = await fetch(SUPABASE_FN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ candidate_token: candidateToken }),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok || !data?.candidate) {
      return NextResponse.json(
        { error: data?.error || "Candidate not found" },
        { status: resp.ok ? 404 : resp.status }
      );
    }

    const c = data.candidate;
    return NextResponse.json({
      candidateName: c.candidate_name ?? c.name ?? "",
      agencyName: c.agency_name ?? "",
      requiredReferences: typeof c.required_references === "number" ? c.required_references : 1,
    });
  } catch (err: any) {
    console.error("candidate-info error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
