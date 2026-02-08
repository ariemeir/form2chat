export async function POST(req: Request) {
  const body = await req.json();
  const { candidateToken, references } = body ?? {};

  if (!candidateToken || typeof candidateToken !== "string") {
    return Response.json({ error: "Missing candidateToken" }, { status: 400 });
  }
  if (!Array.isArray(references) || references.length === 0) {
    return Response.json({ error: "Missing references" }, { status: 400 });
  }

  const upstream = await fetch(new URL("/api/loveable/submit-references", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidate_token: candidateToken,
      references,
    }),
  });

  const text = await upstream.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  return Response.json(data, { status: upstream.status });
}

