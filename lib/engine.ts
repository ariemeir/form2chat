import { db, nowIso } from "./db";
import { loadForm, Field } from "./form";
import crypto from "crypto";
import fs from "fs";

const DEBUG = process.env.DEBUG_ENGINE === "1";
function dlog(...args: any[]) {
  if (DEBUG) console.log(...args);
}

export type InputHint =
  | { type: "text" }
  | { type: "number" }
  | { type: "date" }
  | { type: "choice"; options: string[] }
  | { type: "file"; accept?: string };

type EngineStatus = "in_progress" | "submitted";

/**
 * Session state stored in sessions.answers_json
 */
export type EngineState = {
  __refs: Array<Record<string, any>>; // completed reference objects
  __draft: Record<string, any>; // current reference being filled
};

/**
 * IMPORTANT: We now include `answers_json` in engine responses (esp. submitSession),
 * so /api/submit can reliably access persisted state without re-querying.
 *
 * Architecturally, /api/submit SHOULD read from storage directly long-term,
 * but this unblocks you immediately with minimal surface-area change.
 */
type BaseResponse = {
  sessionId: string;
  answers_json: EngineState;
};

export type ChatResponse =
  | (BaseResponse & {
      kind: "ask";
      fieldId: string;
      message: string;
      input: InputHint;
      progress: { done: number; total: number };
    })
  | (BaseResponse & {
      kind: "review";
      message: string;
      answers: Record<string, any>;
      progress: { done: number; total: number };
    })
  | (BaseResponse & { kind: "done"; message: string });

export type DbSessionRow = {
  id: string;
  form_id: string;
  field_index: number;
  answers_json: string;
  status: EngineStatus;
  updated_at: string;
} & Record<string, any>;

/**
 * Exported so /api/submit can optionally fetch persisted state cleanly
 * without relying on engine return values.
 */
export function getSessionRow(sessionId: string): DbSessionRow | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSessionRow | undefined;
}

function upsertSession(sessionId: string, formId: string): DbSessionRow {
  const s = getSessionRow(sessionId);
  if (s) return s;

  db.prepare(
    "INSERT INTO sessions (id, form_id, field_index, answers_json, status, updated_at) VALUES (?, ?, 0, '{}', 'in_progress', ?)"
  ).run(sessionId, formId, nowIso());

  return getSessionRow(sessionId)!;
}

function parseState(json: string): EngineState {
  try {
    const o = JSON.parse(json || "{}");

    // Back-compat: if old flat answers exist, treat as draft
    if (!o.__refs && !o.__draft) {
      return { __refs: [], __draft: { ...(o || {}) } };
    }

    if (o && typeof o === "object") {
      return {
        __refs: Array.isArray(o.__refs) ? o.__refs : [],
        __draft: o.__draft && typeof o.__draft === "object" ? o.__draft : {},
      };
    }

    return { __refs: [], __draft: {} };
  } catch {
    return { __refs: [], __draft: {} };
  }
}

function saveState(sessionId: string, fieldIndex: number, state: EngineState, status: EngineStatus) {
  db.prepare("UPDATE sessions SET field_index = ?, answers_json = ?, status = ?, updated_at = ? WHERE id = ?").run(
    fieldIndex,
    JSON.stringify(state),
    status,
    nowIso(),
    sessionId
  );
}

function hintForField(field: Field): InputHint {
  switch (field.type) {
    case "text":
      return { type: "text" };
    case "number":
      return { type: "number" };
    case "date":
      return { type: "date" };
    case "select":
    case "radio":
      return { type: "choice", options: field.options ?? [] };
    case "file": {
      const accept = field.validation?.allowedMime?.includes("application/pdf") ? "application/pdf" : undefined;
      return { type: "file", accept };
    }
  }
}

/**
 * ACKS: keep for conversational feel *during data collection* only.
 * We explicitly do NOT apply ACKs to review/done.
 */
const ACKS = ["Got it.", "Perfect — let’s keep going!", "Nice.", "Awesome, thanks."];

function pickAck() {
  return ACKS[Math.floor(Math.random() * ACKS.length)];
}

function extractName(state: EngineState): string | null {
  const possibleKeys = ["name", "full_name", "first_name"];
  for (const k of possibleKeys) {
    const v = state.__draft?.[k];
    if (typeof v === "string" && v.trim().length > 1) return v.trim().split(/\s+/)[0];
  }
  return null;
}

function withAck(res: ChatResponse, state?: EngineState): ChatResponse {
  // Only ACK on "ask". Never ACK on review/done.
  if (res.kind === "ask") {
    const name = state ? extractName(state) : null;
    const ack = name ? `${pickAck()} ${name}.` : pickAck();
    return { ...res, message: `${ack}\n\n${res.message}` } as ChatResponse;
  }
  return res;
}

function validate(field: Field, raw: string): { ok: true; value: any } | { ok: false; error: string } {
  const required = !!field.required;

  if (field.type !== "file" && required && raw.trim() === "") {
    return { ok: false, error: "Please enter a value." };
  }

  if (field.type === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) return { ok: false, error: "Please enter a valid number." };
    return { ok: true, value: n };
  }

  if (field.type === "date") {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Please enter a valid date." };
    return { ok: true, value: raw };
  }

  if (field.type === "select" || field.type === "radio") {
    const opts = field.options ?? [];
    if (!opts.includes(raw)) return { ok: false, error: "Please choose one of the options." };
    return { ok: true, value: raw };
  }

  if (field.type === "text" && field.validation?.kind === "email") {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
    if (!ok) return { ok: false, error: "Please enter a valid email address." };
    return { ok: true, value: raw.trim() };
  }

  return { ok: true, value: raw };
}

function progressFor(formId: string, session: DbSessionRow, form: ReturnType<typeof loadForm>) {
  const state = parseState(session.answers_json);
  const fieldsPer = form.fields.length;
  const totalRefs = Math.max(1, form.targetCount ?? 1);
  const doneRefs = state.__refs.length;
  const fieldIndex = Number(session.field_index ?? 0);
  const done = Math.min(doneRefs * fieldsPer + fieldIndex, totalRefs * fieldsPer);
  const total = totalRefs * fieldsPer;
  return { done, total, doneRefs, totalRefs, state, fieldIndex };
}

function currentRefNumber(p: { doneRefs: number }) {
  return p.doneRefs + 1;
}

function formatValueForSummary(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(formatValueForSummary).filter(Boolean).join(", ");
  if (typeof v === "object") {
    // common file shape in your code:
    // { fileId, name, mime, sizeBytes }
    if (v?.name && v?.mime) return `${v.name} (${v.mime})`;
    return JSON.stringify(v, null, 2);
  }
  return String(v);
}

function buildCleanSummary(form: ReturnType<typeof loadForm>, state: EngineState): string {
  const fields = form.fields;
  const refs = state.__refs;

  if (!refs || refs.length === 0) return "(No references captured)";

  const blocks: string[] = [];

  for (let r = 0; r < refs.length; r++) {
    const ref = refs[r] || {};
    blocks.push(`Reference ${r + 1}`);
    for (const f of fields) {
      const label = (f as any).label ?? f.id;
      const raw = (ref as any)[f.id];
      const val = formatValueForSummary(raw);
      if (val === "") continue;
      blocks.push(`- ${label}: ${val}`);
    }
    if (r !== refs.length - 1) blocks.push(""); // blank line between refs
  }

  return blocks.join("\n");
}

/**
 * Review payload:
 * - references: raw values per ref
 * - fields: id->label mapping for deterministic UI rendering
 */
function buildReviewPayload(form: ReturnType<typeof loadForm>, state: EngineState) {
  return {
    references: state.__refs,
    fields: form.fields.map((f) => ({ id: f.id, label: (f as any).label ?? f.id })),
  };
}

function responseFromState(form: ReturnType<typeof loadForm>, sessionId: string, state: EngineState, fieldIndex: number): ChatResponse {
  const fieldsPer = form.fields.length;
  const totalRefs = Math.max(1, form.targetCount ?? 1);
  const doneRefs = state.__refs.length;

  const total = totalRefs * fieldsPer;
  const done = Math.min(doneRefs * fieldsPer + fieldIndex, total);

  // if finished all refs, show review (clean, no ACK)
  if (doneRefs >= totalRefs) {
    const summary = buildCleanSummary(form, state);
    return {
      kind: "review",
      sessionId,
      answers_json: state,
      message: `To quickly review, does everything look right?\n\n${summary}`,
      answers: buildReviewPayload(form, state),
      progress: { done: total, total },
    };
  }

  const field = form.fields[fieldIndex];
  const header = `Reference ${doneRefs + 1} of ${totalRefs}`;

  if (field.type === "file") {
    return {
      kind: "ask",
      sessionId,
      answers_json: state,
      fieldId: field.id,
      message: `${header}\n\nPlease upload the file using the upload button below.`,
      input: hintForField(field),
      progress: { done, total },
    };
  }

  return {
    kind: "ask",
    sessionId,
    answers_json: state,
    fieldId: field.id,
    message: `${header}\n\n${(field as any).label ?? field.id}`,
    input: hintForField(field),
    progress: { done, total },
  };
}

/**
 * Back behavior:
 * - within a reference: delete the previous field answer from draft
 * - at the start of a reference: go to previous saved reference and remove it
 */
function goBackOne(formId: string, sessionId: string): ChatResponse {
  const form = loadForm(formId);
  const session = getSessionRow(sessionId);
  if (!session) return startOrContinue(formId, sessionId);

  const p = progressFor(formId, session, form);
  const state = p.state;

  // If already at review and there are refs, "back" should bring you to last ref's last field
  if (p.doneRefs >= p.totalRefs) {
    if (state.__refs.length > 0) {
      const last = state.__refs.pop()!;
      state.__draft = { ...last };
      const lastFieldIndex = Math.max(0, form.fields.length - 1);
      saveState(sessionId, lastFieldIndex, state, "in_progress");
      return responseFromState(form, sessionId, state, lastFieldIndex);
    }

    // nothing to go back to
    saveState(sessionId, 0, { __refs: [], __draft: {} }, "in_progress");
    return startOrContinue(formId, sessionId);
  }

  // within a reference
  const idx = p.fieldIndex;
  if (idx > 0) {
    const prevField = form.fields[idx - 1];
    delete state.__draft[prevField.id];
    const prevIdx = idx - 1;
    saveState(sessionId, prevIdx, state, "in_progress");
    return responseFromState(form, sessionId, state, prevIdx);
  }

  // at start of a reference: remove previous committed ref (if any) and restore it into draft
  if (state.__refs.length > 0) {
    const last = state.__refs.pop()!;
    state.__draft = { ...last };
    const lastFieldIndex = Math.max(0, form.fields.length - 1);
    saveState(sessionId, lastFieldIndex, state, "in_progress");
    return responseFromState(form, sessionId, state, lastFieldIndex);
  }

  // nothing to go back to
  saveState(sessionId, 0, { __refs: [], __draft: {} }, "in_progress");
  return startOrContinue(formId, sessionId);
}

export function startOrContinue(formId: string, sessionId?: string): ChatResponse {
  const form = loadForm(formId);
  const sid = sessionId ?? crypto.randomUUID();
  const session = upsertSession(sid, formId);

  if (session.status === "submitted") {
    const state = parseState(session.answers_json);
    return {
      kind: "done",
      sessionId: sid,
      answers_json: state,
      message: "This conversation is already submitted. Thanks!",
    };
  }

  const p = progressFor(formId, session, form);
  const idx = p.fieldIndex;

  // if finished all refs, show review (clean)
  if (p.doneRefs >= p.totalRefs) {
    const summary = buildCleanSummary(form, p.state);
    return {
      kind: "review",
      sessionId: sid,
      answers_json: p.state,
      message: `To quickly review, does everything look right?\n\n${summary}`,
      answers: buildReviewPayload(form, p.state),
      progress: { done: p.total, total: p.total },
    };
  }

  const field = form.fields[idx];
  const header = `Reference ${currentRefNumber(p)} of ${p.totalRefs}`;

  if (field.type === "file") {
    return {
      kind: "ask",
      sessionId: sid,
      answers_json: p.state,
      fieldId: field.id,
      message: `${header}\n\nPlease upload the file using the upload button below.`,
      input: hintForField(field),
      progress: { done: p.done, total: p.total },
    };
  }

  return {
    kind: "ask",
    sessionId: sid,
    answers_json: p.state,
    fieldId: field.id,
    message: `${header}\n\n${(field as any).label ?? field.id}`,
    input: hintForField(field),
    progress: { done: p.done, total: p.total },
  };
}

export function handleUserMessage(formId: string, sessionId: string, userText: string): ChatResponse {
  const form = loadForm(formId);
  const session = upsertSession(sessionId, formId);

  dlog("ENGINE before", {
    formId,
    sessionId,
    userText,
    field_index: session.field_index,
    answers_json_len: (session.answers_json || "").length,
  });

  const state = parseState(session.answers_json);

  const cmd = userText.trim().toLowerCase();
  if (cmd === "restart") {
    saveState(sessionId, 0, { __refs: [], __draft: {} }, "in_progress");
    dlog("ENGINE after restart");
    return startOrContinue(formId, sessionId);
  }
  if (cmd === "back") {
    dlog("ENGINE after back");
    return goBackOne(formId, sessionId);
  }

  const p = progressFor(formId, session, form);

  // finished all refs -> review (clean, no ACK)
  if (p.doneRefs >= p.totalRefs) {
    dlog("ENGINE after review");
    const summary = buildCleanSummary(form, state);
    return {
      kind: "review",
      sessionId,
      answers_json: state,
      message: `To quickly review, does everything look right?\n\n${summary}`,
      answers: buildReviewPayload(form, state),
      progress: { done: p.total, total: p.total },
    };
  }

  const i = p.fieldIndex;
  const field = form.fields[i];

  if (field.type === "file") {
    dlog("ENGINE after file");
    return {
      kind: "ask",
      sessionId,
      answers_json: state,
      fieldId: field.id,
      message: "Please upload the file using the upload button below.",
      input: hintForField(field),
      progress: { done: p.done, total: p.total },
    };
  }

  const v = validate(field, userText);
  if (!v.ok) {
    dlog("ENGINE after validate");
    return {
      kind: "ask",
      sessionId,
      answers_json: state,
      fieldId: field.id,
      message: v.error,
      input: hintForField(field),
      progress: { done: p.done, total: p.total },
    };
  }

  // save draft answer
  state.__draft[field.id] = v.value;

  const nextFieldIndex = i + 1;

  // if completed one full reference (all fields), commit it
  if (nextFieldIndex >= form.fields.length) {
    state.__refs.push({ ...state.__draft });
    state.__draft = {};

    // if more refs remain, reset field_index to 0 and keep going
    if (state.__refs.length < (form.targetCount ?? 1)) {
      saveState(sessionId, 0, state, "in_progress");
      dlog("ENGINE after commit ref, continue");
      return withAck(responseFromState(form, sessionId, state, 0), state);
    }

    // otherwise go to review (responseFromState will be review; withAck is a no-op for review)
    saveState(sessionId, 0, state, "in_progress");
    dlog("ENGINE after commit ref, review");
    return responseFromState(form, sessionId, state, 0);
  }

  // continue within this reference
  saveState(sessionId, nextFieldIndex, state, "in_progress");
  dlog("ENGINE after advance");
  return withAck(responseFromState(form, sessionId, state, nextFieldIndex), state);
}

export function recordFileAndAdvance(params: {
  formId: string;
  sessionId: string;
  fieldId: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  diskPath: string;
  fileId: string;
}): ChatResponse {
  const form = loadForm(params.formId);
  const session = upsertSession(params.sessionId, params.formId);
  const state = parseState(session.answers_json);

  const p = progressFor(params.formId, session, form);
  const expected = form.fields[p.fieldIndex];

  if (!expected || expected.id !== params.fieldId || expected.type !== "file") {
    return startOrContinue(params.formId, params.sessionId);
  }

  db.prepare(
    "INSERT INTO files (id, session_id, field_id, original_name, mime, size_bytes, disk_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(params.fileId, params.sessionId, params.fieldId, params.originalName, params.mime, params.sizeBytes, params.diskPath);

  state.__draft[params.fieldId] = {
    fileId: params.fileId,
    name: params.originalName,
    mime: params.mime,
    sizeBytes: params.sizeBytes,
  };

  const nextFieldIndex = p.fieldIndex + 1;

  if (nextFieldIndex >= form.fields.length) {
    state.__refs.push({ ...state.__draft });
    state.__draft = {};

    saveState(params.sessionId, 0, state, "in_progress");
    // If more refs remain, continue; otherwise responseFromState will return review.
    const res = responseFromState(form, params.sessionId, state, 0);
    return res.kind === "ask" ? withAck(res, state) : res;
  }

  saveState(params.sessionId, nextFieldIndex, state, "in_progress");
  const res = responseFromState(form, params.sessionId, state, nextFieldIndex);
  return res.kind === "ask" ? withAck(res, state) : res;
}

/**
 * Draft completion check used as a safety net at submit time.
 * (Ideally, the engine always commits draft -> refs upon completion, which it does,
 * but this prevents edge cases from blocking submission.)
 */
function isDraftComplete(form: ReturnType<typeof loadForm>, draft: Record<string, any> | undefined | null): boolean {
  if (!draft || typeof draft !== "object") return false;

  for (const f of form.fields) {
    const v = (draft as any)[f.id];

    // if field required, require a non-empty value
    if (f.required) {
      if (v === undefined || v === null) return false;
      if (typeof v === "string" && v.trim() === "") return false;
    }

    // if the draft has started (any key set), you might still want strict completeness
    // for all fields (required or not) before treating it as a reference at submit time.
  }

  // stricter: if draft has any keys, require all fields to exist
  const started = Object.keys(draft).length > 0;
  if (!started) return false;

  for (const f of form.fields) {
    const v = (draft as any)[f.id];
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
  }

  return true;
}

function commitDraftIfComplete(form: ReturnType<typeof loadForm>, state: EngineState): EngineState {
  if (state.__refs.length > 0) return state; // don't mutate behavior if refs already exist
  if (isDraftComplete(form, state.__draft)) {
    state.__refs.push({ ...state.__draft });
    state.__draft = {};
  }
  return state;
}

export function submitSession(formId: string, sessionId: string): ChatResponse {
  const session = getSessionRow(sessionId);
  if (!session) {
    return { kind: "done", sessionId, answers_json: { __refs: [], __draft: {} }, message: "Session not found." };
  }

  const form = loadForm(formId);

  // Load + safety-commit draft if needed (prevents __refs empty edge case)
  const state = commitDraftIfComplete(form, parseState(session.answers_json));

  // Persist submission (append-only)
  db.prepare("INSERT INTO submissions (id, session_id, form_id, answers_json) VALUES (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    sessionId,
    formId,
    JSON.stringify(state)
  );

  // Mark session submitted
  const p = progressFor(formId, session, form);
  saveState(sessionId, p.fieldIndex, state, "submitted");

  // Return clean summary, no ACKs.
  const summary = buildCleanSummary(form, state);
  return {
    kind: "done",
    sessionId,
    answers_json: state,
    message: `Submitted. Here’s the information you provided:\n\n${summary}`,
  };
}

/**
 * Deletes a file on disk if it exists; best-effort.
 */
function safeUnlink(p: string) {
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

