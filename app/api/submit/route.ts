// app/api/submit/route.ts

function normalizeWouldRehire(v: any): "Yes" | "No" | "Unsure" | "" {
  if (typeof v !== "string") return "";
  const raw = v.trim();

  // already correct
  if (raw === "Yes" || raw === "No" || raw === "Unsure") return raw;

  const s = raw.toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return "Yes";
  if (["no", "n", "false", "0"].includes(s)) return "No";
  if (["unsure", "not sure", "maybe", "unknown"].includes(s)) return "Unsure";

  return "";
}

function pickString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function canonicalizeReference(raw: Record<string, any>) {
  return {
    name: pickString(raw, ["name", "full_name", "ref_name", "reference_name", "contact_name"]),
    email: pickString(raw, ["email", "email_address", "ref_email", "reference_email"]),
    relationship: pickString(raw, ["relationship", "ref_relationship", "relationship_to_candidate", "reference_relationship", "relation"]),
  };
}

async function callLoveable(url: string, body: Record<string, any>) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.LOVEABLE_ANON_KEY!,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || "Upstream error" };
  }

  if (!resp.ok) {
    return Response.json(
      { error: data?.error || `Upstream HTTP ${resp.status}` },
      { status: resp.status }
    );
  }

  return Response.json(data);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { formId, candidateToken, references, answers } = body ?? {};

    if (!formId || typeof formId !== "string") {
      return Response.json({ error: "Missing formId" }, { status: 400 });
    }

    if (!candidateToken || typeof candidateToken !== "string") {
      return Response.json({ error: "Missing candidateToken" }, { status: 400 });
    }

    // Candidate flow — submit references to loveable
    if (formId === "candidate") {
      if (!Array.isArray(references) || references.length === 0) {
        return Response.json({ error: "Missing references" }, { status: 400 });
      }

      const canonicalRefs = references.map((r: any) => canonicalizeReference(r ?? {}));
      for (let i = 0; i < canonicalRefs.length; i++) {
        const r = canonicalRefs[i];
        if (!r.name || !r.email || !r.relationship) {
          return Response.json(
            { error: `Reference #${i + 1} missing name/email/relationship`, canonical: r },
            { status: 400 }
          );
        }
      }

      return callLoveable(process.env.LOVEABLE_SUBMIT_URL!, {
        candidate_token: candidateToken,
        base_url: process.env.LOVEABLE_BASE_URL!,
        references: canonicalRefs,
      });
    }

    // Reference-provider flow — submit answers to loveable
    if (formId === "reference") {
      if (!answers || typeof answers !== "object") {
        return Response.json({ error: "Missing answers" }, { status: 400 });
      }

      const how_know = (answers as any)?.how_do_you_know_candidate;
      const care_type = (answers as any)?.work_type;
      const duration = (answers as any)?.duration_worked_together;
      const would_rehire = normalizeWouldRehire((answers as any)?.rehire);
      const concerns = (answers as any)?.concerns ?? null;
      const additional_comments = (answers as any)?.additional_comments ?? null;

      if (!how_know || !care_type || !duration || !would_rehire) {
        return Response.json(
          {
            error: "Missing required reference answers",
            missing: {
              how_know: !how_know,
              care_type: !care_type,
              duration: !duration,
              would_rehire: !would_rehire,
            },
            received_keys: Object.keys(answers ?? {}),
          },
          { status: 400 }
        );
      }

      return callLoveable(process.env.LOVEABLE_SUBMIT_REFERENCE_URL!, {
        reference_token: candidateToken,
        how_know,
        care_type,
        duration,
        would_rehire,
        concerns,
        additional_comments,
      });
    }

    return Response.json({ error: "Unknown formId", formId }, { status: 400 });
  } catch (err: any) {
    console.error("Submit route error:", err);
    return Response.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
