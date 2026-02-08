// app/api/submit/route.ts
export const runtime = "nodejs"; // keep it on Node runtime

type RefIn = Record<string, any>;

function pickString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function canonicalizeReference(raw: RefIn) {
  const name = pickString(raw, ["name", "full_name", "ref_name", "reference_name", "contact_name"]);
  const email = pickString(raw, ["email", "email_address", "ref_email", "reference_email"]);
  const relationshipRaw = pickString(raw, [
    "relationship",
    "ref_relationship",
    "relationship_to_candidate",
    "reference_relationship",
    "relation",
  ]);

  // If your Edge function expects an enum, map common user-facing phrases.
  // (You can refine once you confirm the exact allowed set.)
  const relationship = mapRelationshipToAllowed(relationshipRaw);

  return { ...raw, name, email, relationship };
}

// Update this mapping to match EXACT allowed values in Loveable edge function.
function mapRelationshipToAllowed(input?: string) {
  if (!input) return undefined;
  const s = input.trim().toLowerCase();

  // common normalizations
  if (["manager", "supervisor", "boss", "former supervisor", "direct manager"].includes(s)) return "manager";
  if (["coworker", "colleague", "peer"].includes(s)) return "coworker";
  if (["client", "customer"].includes(s)) return "client";
  if (["friend"].includes(s)) return "friend";
  if (["family", "relative"].includes(s)) return "family";

  // safest fallback (only if 'other' is allowed)
  return "other";
}

function validateReference(r: any) {
  if (!r?.name || typeof r.name !== "string") return "missing name";
  if (!r?.email || typeof r.email !== "string") return "missing email";
  if (!r?.relationship || typeof r.relationship !== "string") return "missing relationship";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return "invalid email";
  return null;
}

export async function POST(req: Request) {
  // Limit payload size via headers? Next doesn't give a hard cap here,
  // so do a logical cap below.
  const body = await req.json();

  const formId = body?.formId;
  const sessionId = body?.sessionId;
  const candidateToken = body?.candidateToken;
  const refs = body?.references;

  if (!candidateToken || typeof candidateToken !== "string") {
    return Response.json({ error: "Missing candidateToken" }, { status: 400 });
  }
  if (!Array.isArray(refs)) {
    return Response.json({ error: "Missing references array" }, { status: 400 });
  }
  if (refs.length === 0) {
    return Response.json({ error: "No references provided" }, { status: 400 });
  }
  if (refs.length > 10) {
    return Response.json({ error: "Too many references" }, { status: 400 });
  }

  // Canonicalize + validate server-side (do NOT log PII)
  const canonicalRefs = refs.map(canonicalizeReference);

  for (let i = 0; i < canonicalRefs.length; i++) {
    const err = validateReference(canonicalRefs[i]);
    if (err) {
      return Response.json(
        { error: `Reference #${i + 1} ${err}` },
        { status: 400 }
      );
    }
  }

  // Call your secure proxy (same deployment, no env base-url issues)
  const upstream = await fetch(new URL("/api/loveable/submit-references", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidate_token: candidateToken,
      // base_url is set inside proxy from env; no need to send from client
      references: canonicalRefs,
      // keep these if your proxy/edge expects them, but never rely on them for auth
      formId,
      sessionId,
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

