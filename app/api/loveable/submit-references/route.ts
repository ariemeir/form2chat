import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
          references,
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

