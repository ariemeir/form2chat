import { submitSession, getSessionRow } from "@/lib/engine"; // adjust path if different

export async function POST(req: Request) {
  const { formId, sessionId, candidateToken } = await req.json();

  // 1) Finalize/commit in engine (moves __draft -> __refs when complete)
  const engineResp = submitSession(formId, sessionId);

  // 2) Load persisted session state (preferred)
  const row = getSessionRow(sessionId);

  const answers =
    row?.answers_json ? JSON.parse(row.answers_json) : (engineResp as any).answers_json;

  const refs = Array.isArray(answers?.__refs) ? answers.__refs : [];
  const draft = answers?.__draft && typeof answers.__draft === "object" ? answers.__draft : null;

  // 3) Fallback: if refs empty but draft has data, submit draft as single ref
  const references =
    refs.length > 0 ? refs : draft && Object.keys(draft).length > 0 ? [draft] : [];

  // Debug once (check Vercel logs)
  console.log("API_SUBMIT extracted references:", JSON.stringify(references, null, 2));

  if (!references.length) {
    return Response.json(
      { error: "No references found in session state", sessionId },
      { status: 400 }
    );
  }

  // 4) Call your secure proxy (RELATIVE URL so it works on Vercel + locally)
  const upstream = await fetch(new URL("/api/loveable/submit-references", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidate_token: candidateToken, // snake_case because your proxy expects candidate_token
      references,
    }),
  });

  const text = await upstream.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return Response.json(data, { status: upstream.status });
}

