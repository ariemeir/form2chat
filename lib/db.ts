import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function nowIso() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Vercel/serverless seen as read-only outside /tmp.
// Use /tmp for the sqlite file in production deployments.
const isVercel = !!process.env.VERCEL;
const dbPath = isVercel
  ? "/tmp/form2chat.db"
  : path.join(process.cwd(), "data", "form2chat.db");

if (!isVercel) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(dbPath);

// Schema init
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  field_index INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'in_progress',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  disk_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

