import { db, nowIso } from "./db";
import { loadForm, Field } from "./form";
import crypto from "crypto";
import fs from "fs";

export type ChatResponse =
  | {
      kind: "ask";
      sessionId: string;
      fieldId: string;
      message: string;
      input: InputHint;
      progress: { done: number; total: number };
    }
  | {
      kind: "review";
      sessionId: string;
      message: string;
      answers: Record<string, any>;
      progress: { done: number; total: number };
    }
  | { kind: "done"; sessionId: string; message: string };

export type InputHint =
  | { type: "text" }
  | { type: "number" }
  | { type: "date" }
  | { type: "choice"; options: string[] }
  | { type: "file"; accept?: string };

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any | undefined;
}

function upsertSession(sessionId: string, formId: string) {
  const s = getSession(sessionId);
  if (s) return s;
  db.prepare(
    "INSERT INTO sessions (id, form_id, field_index, answers_json, status, updated_at) VALUES (?, ?, 0, '{}', 'in_progress', ?)"
  ).run(sessionId, formId, nowIso());
  return getSession(sessionId)!;
}

type EngineState = {
  __refs: Array<Record<string, any>>; // completed reference objects
  __draft: Record<string, any>; // current reference being filled
};

function parseState(json: string): EngineState {
  try {
    const o = JSON.parse(json || "{}");
    // Back-compat: if old flat answers exist, treat as draft
    if (!o.__refs && !o.__draft) {
      return { __refs: [], __draft: { ...(o || {}) } };
    }
    return {
      __refs: Array.isArray(o.__refs) ? o.__refs : [],
      __draft: o.__draft && typeof o.__draft === "object" ? o.__draft : {},
    };
  } catch {
    return { __refs: [], __draft: {} };
  }
}

function saveState(sessionId: string, fieldIndex: number, state: EngineState, status: string = "in_progress") {
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
  if (res.kind === "ask" || res.kind === "review") {
    const name = state ? extractName(state) : null;
    const ack = name ? `${pickAck()} ${name}.` : pickAck();
    return { ...res, message: `${ack}\n\n${res.message}` } as ChatResponse;
  }
  return res;
}

function validate(field: Field, raw: string): { ok: true; value: any } | { ok: false; error: string } {
  const required = !!field.required;

  if (field.type !== "file" && required && raw.trim() === "") {
    return { ok: false, error: "I need something here — can you enter a value?" };
  }

  if (field.type === "text") {
    if (field.validation?.kind === "email") {
      const v = raw.trim();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if (!emailOk) return { ok: false, error: "That doesn’t look like an email. Can you try again?" };
      return { ok: true, value: v };
    }
    return { ok: true, value: raw.trim() };
  }

  if (field.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: "Can you enter a number?" };
    if (field.validation?.min != null && n < field.validation.min)
      return { ok: false, error: `Please enter a number ≥ ${field.validation.min}.` };
    if (field.validation?.max != null && n > field.validation.max)
      return { ok: false, error: `Please enter a number ≤ ${field.validation.max}.` };
    return { ok: true, value: n };
  }

  if (field.type === "date") {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return { ok: false, error: "Can you enter a date (or use the date picker)?" };
    return { ok: true, value: new Date(t).toISOString().slice(0, 10) };
  }

  if (field.type === "select" || field.type === "radio") {
    const options = field.options ?? [];
    const normalized = raw.trim().toLowerCase();

    const idx = Number(normalized);
    if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) {
      return { ok: true, value: options[idx - 1] };
    }

    const match = options.find((o) => o.toLowerCase() === normalized);
    if (!match) return { ok: false, error: `Pick one of: ${options.join(", ")}.` };
    return { ok: true, value: match };
  }

  return { ok: true, value: raw.trim() };
}

// overall progress across all refs
function progressFor(formId: string, session: any, form: ReturnType<typeof loadForm>) {
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

/**
 * Back behavior:
 * - within a reference: delete the previous field answer from draft
 * - at the start of a reference: go to previous saved reference and remove it (and delete any file for that ref if needed)
 */
function goBackOne(formId: string, sessionId: string): ChatResponse {
  const form = loadForm(formId);
  const session = getSession(sessionId);
  if (!session) return startOrContinue(formId, sessionId);

  const { state, fieldIndex, doneRefs, totalRefs } = progressFor(formId, session, form);

  // if at the start of the first ref, nothing to do
  if (doneRefs === 0 && fieldIndex <= 0) {
    saveState(sessionId, 0, state, "in_progress");
    return startOrContinue(formId, sessionId);
  }

  // if inside current draft (fieldIndex > 0): move back within draft and delete the previous answer
  if (fieldIndex > 0) {
    const prevField = form.fields[fieldIndex - 1];
    if (prevField?.type === "file") {
      // delete latest file for this session+field
      const f = db
        .prepare("SELECT id, disk_path FROM files WHERE session_id = ? AND field_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(sessionId, prevField.id) as any | undefined;
      if (f?.disk_path) {
        try { fs.unlinkSync(f.disk_path); } catch {}
      }
      if (f?.id) db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
    }

    delete state.__draft[prevField.id];
    saveState(sessionId, fieldIndex - 1, state, "in_progress");
    return startOrContinue(formId, sessionId);
  }

  // fieldIndex === 0, so move back to previous completed ref
  const prev = state.__refs.pop(); // remove last saved ref object
  // (If you later add file fields inside refs, you can also delete their attachments here based on prev content)
  saveState(sessionId, form.fields.length - 1, state, "in_progress");
  return {
    kind: "ask",
    sessionId,
    fieldId: form.fields[form.fields.length - 1].id,
    message: `Okay — back to reference ${Math.max(1, doneRefs)}. ${form.fields[form.fields.length - 1].label}`,
    input: hintForField(form.fields[form.fields.length - 1]),
    progress: {
      done: Math.min((state.__refs.length * form.fields.length) + (form.fields.length - 1), (totalRefs * form.fields.length)),
      total: totalRefs * form.fields.length,
    },
  };
}

export function startOrContinue(formId: string, sessionId?: string): ChatResponse {
  const form = loadForm(formId);
  const sid = sessionId ?? crypto.randomUUID();
  const session = upsertSession(sid, formId);

  if (session.status === "submitted") {
    return { kind: "done", sessionId: sid, message: "This conversation is already submitted. Thanks!" };
  }

  const p = progressFor(formId, session, form);
  const totalFields = form.fields.length;
  const idx = p.fieldIndex;

  // if finished all refs, show review
  if (p.doneRefs >= p.totalRefs) {
    return {
      kind: "review",
      sessionId: sid,
      message: "Quick review — does everything look right?",
      answers: { references: p.state.__refs },
      progress: { done: p.total, total: p.total },
    };
  }

  const field = form.fields[idx];
  const header = `Reference ${currentRefNumber(p)} of ${p.totalRefs}`;
  return {
    kind: "ask",
    sessionId: sid,
    fieldId: field.id,
    message: `${header}\n\n${field.label}`,
    input: hintForField(field),
    progress: { done: p.done, total: p.total },
  };
}

export function handleUserMessage(formId: string, sessionId: string, userText: string): ChatResponse {
  const form = loadForm(formId);
  const session = upsertSession(sessionId, formId);
  const state = parseState(session.answers_json);

  const cmd = userText.trim().toLowerCase();
  if (cmd === "restart") {
    saveState(sessionId, 0, { __refs: [], __draft: {} }, "in_progress");
    return startOrContinue(formId, sessionId);
  }
  if (cmd === "back") {
    return goBackOne(formId, sessionId);
  }

  const p = progressFor(formId, session, form);

  // finished all refs -> review
  if (p.doneRefs >= p.totalRefs) {
    return {
      kind: "review",
      sessionId,
      message: "Quick review — does everything look right?",
      answers: { references: state.__refs },
      progress: { done: p.total, total: p.total },
    };
  }

  const i = p.fieldIndex;
  const field = form.fields[i];

  if (field.type === "file") {
    return {
      kind: "ask",
      sessionId,
      fieldId: field.id,
      message: "Please upload the file using the upload button below.",
      input: hintForField(field),
      progress: { done: p.done, total: p.total },
    };
  }

  const v = validate(field, userText);
  if (!v.ok) {
    return {
      kind: "ask",
      sessionId,
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
      const r = startOrContinue(formId, sessionId);
      return withAck(r, state);
    }

    // otherwise go to review
    saveState(sessionId, 0, state, "in_progress");
    return withAck(startOrContinue(formId, sessionId), state);
  }

  // continue within this reference
  saveState(sessionId, nextFieldIndex, state, "in_progress");
  return withAck(startOrContinue(formId, sessionId), state);
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

  db.prepare("INSERT INTO files (id, session_id, field_id, original_name, mime, size_bytes, disk_path) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    params.fileId,
    params.sessionId,
    params.fieldId,
    params.originalName,
    params.mime,
    params.sizeBytes,
    params.diskPath
  );

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
    return withAck(startOrContinue(params.formId, params.sessionId), state);
  }

  saveState(params.sessionId, nextFieldIndex, state, "in_progress");
  return withAck(startOrContinue(params.formId, params.sessionId), state);
}

export function submitSession(formId: string, sessionId: string): ChatResponse {
  const session = getSession(sessionId);
  if (!session) return { kind: "done", sessionId, message: "No active session found." };

  const state = parseState(session.answers_json);

  const submissionId = crypto.randomUUID();
  db.prepare("INSERT INTO submissions (id, session_id, form_id, answers_json) VALUES (?, ?, ?, ?)").run(
    submissionId,
    sessionId,
    formId,
    JSON.stringify({ references: state.__refs })
  );

  saveState(sessionId, Number(session.field_index ?? 0), state, "submitted");
  return { kind: "done", sessionId, message: "Submitted. Thank you!" };
}

