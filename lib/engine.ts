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

function saveState(sessionId: string, fieldIndex: number, state: EngineState, status: "in_progress" | "submitted") {
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

function responseFromState(form: ReturnType<typeof loadForm>, sessionId: string, state: EngineState, fieldIndex: number): ChatResponse {
  const fieldsPer = form.fields.length;
  const totalRefs = Math.max(1, form.targetCount ?? 1);
  const doneRefs = state.__refs.length;

  const total = totalRefs * fieldsPer;
  const done = Math.min(doneRefs * fieldsPer + fieldIndex, total);

  // if finished all refs, show review
  if (doneRefs >= totalRefs) {
    return {
      kind: "review",
      sessionId,
      message: "Quick review — does everything look right?",
      // Include field order to allow deterministic rendering in UI
      answers: {
        references: state.__refs,
        fields: form.fields.map((f) => ({ id: f.id, label: f.label })),
      },
      progress: { done: total, total },
    };
  }

  const field = form.fields[fieldIndex];
  const header = `Reference ${doneRefs + 1} of ${totalRefs}`;

  if (field.type === "file") {
    return {
      kind: "ask",
      sessionId,
      fieldId: field.id,
      message: `${header}\n\nPlease upload the file using the upload button below.`,
      input: hintForField(field),
      progress: { done, total },
    };
  }

  return {
    kind: "ask",
    sessionId,
    fieldId: field.id,
    message: `${header}\n\n${field.label}`,
    input: hintForField(field),
    progress: { done, total },
  };
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
    return { kind: "done", sessionId: sid, message: "This conversation is already submitted. Thanks!" };
  }

  const p = progressFor(formId, session, form);
  const idx = p.fieldIndex;

  // if finished all refs, show review
  if (p.doneRefs >= p.totalRefs) {
    return {
      kind: "review",
      sessionId: sid,
      message: "Quick review — does everything look right?",
      answers: { references: p.state.__refs, fields: form.fields.map((f) => ({ id: f.id, label: f.label })) },
      progress: { done: p.total, total: p.total },
    };
  }

  const field = form.fields[idx];
  const header = `Reference ${currentRefNumber(p)} of ${p.totalRefs}`;

  if (field.type === "file") {
    return {
      kind: "ask",
      sessionId: sid,
      fieldId: field.id,
      message: `${header}\n\nPlease upload the file using the upload button below.`,
      input: hintForField(field),
      progress: { done: p.done, total: p.total },
    };
  }

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
      answers: { references: state.__refs, fields: form.fields.map((f) => ({ id: f.id, label: f.label })) },
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
      return withAck(responseFromState(form, sessionId, state, 0), state);
    }

    // otherwise go to review
    saveState(sessionId, 0, state, "in_progress");
    return withAck(responseFromState(form, sessionId, state, 0), state);
  }

  // continue within this reference
  saveState(sessionId, nextFieldIndex, state, "in_progress");
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
    return withAck(responseFromState(form, params.sessionId, state, 0), state);
  }

  saveState(params.sessionId, nextFieldIndex, state, "in_progress");
  return withAck(responseFromState(form, params.sessionId, state, nextFieldIndex), state);
}

export function submitSession(formId: string, sessionId: string): ChatResponse {
  const session = getSession(sessionId);
  if (!session) return { kind: "done", sessionId, message: "Session not found." };

  const form = loadForm(formId);
  const p = progressFor(formId, session, form);

  // Persist submission (append-only)
  db.prepare("INSERT INTO submissions (id, session_id, form_id, answers_json) VALUES (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    sessionId,
    formId,
    session.answers_json
  );

  // Mark session submitted
  saveState(sessionId, p.fieldIndex, p.state, "submitted");

  return { kind: "done", sessionId, message: "Submitted. Thank you!" };
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

