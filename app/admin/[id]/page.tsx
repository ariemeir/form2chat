import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SubmissionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params; // <-- key fix in Next 15+/16
  const id = decodeURIComponent(String(rawId ?? ""));

  const row = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id) as any;

  if (!row) {
    const recent = db
      .prepare("SELECT id, created_at FROM submissions ORDER BY created_at DESC LIMIT 10")
      .all() as any[];

    return (
      <div style={{ maxWidth: 900, margin: "24px auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <h1 style={{ fontSize: 18 }}>Not found</h1>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
          Requested id: <code>{id}</code>
        </div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent submission IDs</div>
        <pre style={{ margin: 0, fontSize: 12, background: "#fafafa", padding: 12, borderRadius: 12, border: "1px solid #eee" }}>
          {JSON.stringify(recent, null, 2)}
        </pre>
        <div style={{ marginTop: 12, fontSize: 12 }}>
          <a href="/admin">Back</a>
        </div>
      </div>
    );
  }

  const answers = JSON.parse(row.answers_json || "{}");

  return (
    <div style={{ maxWidth: 900, margin: "24px auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Submission {row.id}</h1>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>{row.created_at}</div>

      <pre style={{ margin: 0, fontSize: 12, background: "#fafafa", padding: 12, borderRadius: 12, border: "1px solid #eee", overflowX: "auto" }}>
        {JSON.stringify(answers, null, 2)}
      </pre>

      <div style={{ marginTop: 12, fontSize: 12 }}>
        <a href="/admin">Back</a>
      </div>
    </div>
  );
}

