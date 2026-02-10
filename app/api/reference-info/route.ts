import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPABASE_FN =
  "https://cqrtlfgnsmvkfngmdctm.supabase.co/functions/v1/get-reference-by-token";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const referenceToken = body?.reference_token;

    if (!referenceToken || typeof referenceToken !== "string") {
      return NextResponse.json({ error: "Missing reference_token" }, { status: 400 });
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
      body: JSON.stringify({ reference_token: referenceToken }),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok || !data?.reference) {
      return NextResponse.json(
        { error: data?.error || "Reference not found" },
        { status: resp.ok ? 404 : resp.status }
      );
    }

    const ref = data.reference;
    return NextResponse.json({
      providerName: ref.provider_name ?? ref.reference_name ?? "",
      candidateName: ref.candidate_name ?? "",
      agencyName: ref.agency_name ?? "",
    });
  } catch (err: any) {
    console.error("reference-info error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
