import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "local.db");
const firstTime = !fs.existsSync(dbPath);
export const db = new Database(dbPath);

if (firstTime) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      field_index INTEGER NOT NULL DEFAULT 0,
      answers_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'in_progress',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE submissions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      form_id TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE files (
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
}

export function nowIso() {
  return new Date().toISOString();
}
