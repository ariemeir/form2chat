import { NextResponse } from "next/server";

export const runtime = "nodejs";


function pickString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function canonicalizeReference(raw: Record<string, any>) {
  // If your engine uses different field IDs, map them here
  const name = pickString(raw, ["name", "full_name", "ref_name", "reference_name", "contact_name"]);
  const email = pickString(raw, ["email", "email_address", "ref_email", "reference_email"]);
  const relationship = pickString(raw, [
    "relationship",
    "ref_relationship",
    "relationship_to_candidate",
    "reference_relationship",
    "relation",
  ]);

  return {
    ...raw, // keep original keys for debugging / future use
    name,
    email,
    relationship,
  };
}

function canonicalizeReferences(refs: any[]) {
  return (Array.isArray(refs) ? refs : []).map((r) => canonicalizeReference(r ?? {}));
}





/**
 * Proxy route:
 * Vercel Server → Loveable Edge Function
 *
 * Keeps API keys off the browser
 * Allows logging / retries later
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { candidate_token, references } = body ?? {};

    if (!candidate_token) {
      return NextResponse.json(
        { error: "Missing candidate_token" },
        { status: 400 }
      );
    }

    if (!Array.isArray(references) || references.length === 0) {
      return NextResponse.json(
        { error: "Missing references array" },
        { status: 400 }
      );
    }

    console.log("LOVEABLE_SUBMIT_URL =", process.env.LOVEABLE_SUBMIT_URL);

const canonicalRefs = canonicalizeReferences(references);

for (let i = 0; i < canonicalRefs.length; i++) {
  const r = canonicalRefs[i];
  if (!r.name || !r.email || !r.relationship) {
    return Response.json(
      {
        error: `Reference #${i + 1} missing name/email/relationship`,
        received_keys: Object.keys(references?.[i] ?? {}),
        canonical: r,
      },
      { status: 400 }
    );
  }
}



    // 🔑 Call Loveable edge function
    const upstream = await fetch(
      process.env.LOVEABLE_SUBMIT_URL!,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.LOVEABLE_ANON_KEY!, // stays server-side
        },
        body: JSON.stringify({
          candidate_token,
          base_url: process.env.LOVEABLE_BASE_URL!,
          references: canonicalRefs,
        }),
      }
    );

    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || "Upstream error" };
    }

    if (!upstream.ok) {
      console.error("Loveable submit failed:", data);

      return NextResponse.json(
        { error: data?.error || "Failed to submit references" },
        { status: upstream.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Proxy crash:", err);

    return NextResponse.json(
      { error: "Server error while submitting references" },
      { status: 500 }
    );
  }
}

