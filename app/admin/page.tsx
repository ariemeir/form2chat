import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const rows = db
    .prepare("SELECT id, session_id, form_id, created_at FROM submissions ORDER BY created_at DESC")
    .all() as any[];

  return (
    <div style={{ maxWidth: 900, margin: "24px auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1 style={{ fontSize: 18 }}>Submissions</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 12 }}>No submissions yet.</div>
        ) : (
          rows.map((r, idx) => {
            const id = String(r.id ?? "");
            const href = `/admin/${encodeURIComponent(id)}`;
            return (
              <a
                key={`${id}-${idx}`}
                href={href}
                style={{ display: "block", padding: 12, borderTop: "1px solid #eee", textDecoration: "none", color: "#111" }}
              >
                <div style={{ fontWeight: 600 }}>{id}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{r.created_at} • form={r.form_id}</div>
              </a>
            );
          })
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        Back to <a href="/demo">/demo</a>
      </div>
    </div>
  );
}

