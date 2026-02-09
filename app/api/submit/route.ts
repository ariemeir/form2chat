// app/api/submit/route.ts

import { POST as submitReferencesHandler } from "../loveable/submit-references/route";
import { POST as submitReferenceResponseHandler } from "../loveable/submit-reference-response/route";

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { formId, candidateToken, references, answers } = body ?? {};

  // formId is required so we don't guess wrong
  if (!formId || typeof formId !== "string") {
    return Response.json({ error: "Missing formId" }, { status: 400 });
  }

  // used as candidate_token for candidate flow, and reference_token for reference flow (naming mismatch ok for now)
  if (!candidateToken || typeof candidateToken !== "string") {
    return Response.json({ error: "Missing candidateToken" }, { status: 400 });
  }

  // Candidate flow
  if (formId === "candidate") {
    if (!Array.isArray(references) || references.length === 0) {
      return Response.json({ error: "Missing references" }, { status: 400 });
    }

    const internalReq = new Request("http://localhost/api/loveable/submit-references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_token: candidateToken,
        references,
      }),
    });

    return submitReferencesHandler(internalReq);
  }

  // Reference-provider flow
  if (formId === "reference") {
    if (!answers || typeof answers !== "object") {
      return Response.json({ error: "Missing answers" }, { status: 400 });
    }

    // Map form engine field IDs -> edge function field names
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

    const internalReq = new Request("http://localhost/api/loveable/submit-reference-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference_token: candidateToken,
        how_know,
        care_type,
        duration,
        would_rehire,
        concerns,
        additional_comments,
      }),
    });

    return submitReferenceResponseHandler(internalReq);
  }

  return Response.json({ error: "Unknown formId", formId }, { status: 400 });
}

