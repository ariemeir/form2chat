import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeString(v: any, maxLen: number) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const reference_token = sanitizeString(body?.reference_token, 100);
    const how_know = sanitizeString(body?.how_know, 200);
    const care_type = sanitizeString(body?.care_type, 200);
    const duration = sanitizeString(body?.duration, 100);
    const would_rehire = sanitizeString(body?.would_rehire, 20);
    const concerns = sanitizeString(body?.concerns, 2000) || null;
    const additional_comments = sanitizeString(body?.additional_comments, 2000) || null;

    if (!reference_token || !how_know || !care_type || !duration || !would_rehire) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          missing: {
            reference_token: !reference_token,
            how_know: !how_know,
            care_type: !care_type,
            duration: !duration,
            would_rehire: !would_rehire,
          },
        },
        { status: 400 }
      );
    }

    const upstream = await fetch(process.env.LOVEABLE_SUBMIT_REFERENCE_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.LOVEABLE_ANON_KEY!,
      },
      body: JSON.stringify({
        reference_token,
        how_know,
        care_type,
        duration,
        would_rehire,
        concerns,
        additional_comments,
      }),
    });

    const text = await upstream.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (err: any) {
    console.error("Proxy crash:", err);
    return NextResponse.json(
      { error: "Server error while submitting reference response" },
      { status: 500 }
    );
  }
}

