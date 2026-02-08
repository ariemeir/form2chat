import { NextResponse } from "next/server";
import { submitSession } from "@/lib/engine";

export const runtime = "nodejs";

type RefOut = {
  name: string;
  email: string;
  relationship:
    | "supervisor"
    | "client"
    | "coworker"
    | "friend"
    | "family"
    | "other";
  relationship_explanation?: string;
};

export async function POST(req: Request) {
  const body = await req.json();

  const formId = body.formId ?? "demo";
  const sessionId = body.sessionId as string | undefined;
  const candidateToken = (body.candidateToken ?? null) as string | null;

  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // 1) Run your engine submit (this produces kind:"done" + final summary message)
  const engineResp = submitSession(formId, sessionId);

  // 2) If candidateToken present, push refs into Loveable via our server proxy
  if (candidateToken) {
    const answers =
      (engineResp as any)?.answers_json ??
      (engineResp as any)?.answers ??
      null;

    const refsRaw = answers?.__refs;
 
    console.log("AAA SUBMIT engineResp keys:", Object.keys(engineResp as any));
    console.log("SUBMIT answers_json:", JSON.stringify((engineResp as any)?.answers_json ?? null));
    console.log("SUBMIT answers:", JSON.stringify((engineResp as any)?.answers ?? null));

    if (!Array.isArray(refsRaw) || refsRaw.length < 1) {
      return NextResponse.json(
        { error: "No references found to submit (answers.__refs missing/empty)" },
        { status: 400 }
      );
    }

    const references: RefOut[] = refsRaw.map((r: any) => ({
      name: String(r?.name ?? "").trim(),
      email: String(r?.email ?? "").trim(),
      relationship: r?.relationship,
      relationship_explanation: String(r?.relationship_explanation ?? "").trim(),
    }));

    // small validation before calling upstream
    for (const [i, r] of references.entries()) {
      if (!r.name || !r.email || !r.relationship) {
        return NextResponse.json(
          { error: `Reference #${i + 1} missing name/email/relationship` },
          { status: 400 }
        );
      }
      if (r.relationship !== "other") {
        delete (r as any).relationship_explanation;
      }
      if (r.relationship === "other" && !r.relationship_explanation) {
        return NextResponse.json(
          {
            error: `Reference #${i + 1} relationship_explanation required when relationship=other`,
          },
          { status: 400 }
        );
      }
    }

    const url = new URL("/api/loveable/submit-references", req.url);
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_token: candidateToken,
        references,
      }),
    });

    const upstreamText = await upstream.text();
    let upstreamJson: any = null;
    try {
      upstreamJson = JSON.parse(upstreamText);
    } catch {
      upstreamJson = { error: upstreamText || "Upstream error" };
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: upstreamJson?.error || "Failed to submit references" },
        { status: upstream.status }
      );
    }
  }

  // 3) Return engine response to UI
  return NextResponse.json(engineResp);
}

