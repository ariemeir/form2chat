"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type InputHint =
  | { type: "text" }
  | { type: "number" }
  | { type: "date" }
  | { type: "choice"; options: string[] }
  | { type: "file"; accept?: string };

type BotRes =
  | { kind: "ask"; sessionId: string; fieldId: string; message: string; input: InputHint; progress: { done: number; total: number } }
  | { kind: "review"; sessionId: string; message: string; answers: Record<string, any>; progress: { done: number; total: number } }
  | { kind: "done"; sessionId: string; message: string };

type Msg = { from: "bot" | "user"; text: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function BotAvatar() {
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        background: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        flexShrink: 0,
      }}
      title="Assistant"
    >
      💼
    </div>
  );
}

export default function DemoPage() {
  const formId = "demo";

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState<string>("");
  const [bot, setBot] = useState<BotRes | null>(null);
  const [typing, setTyping] = useState(false);
  const [uploading, setUploading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const progressLabel = useMemo(() => {
    if (!bot) return "";
    if (bot.kind === "done") return "";
    return `${bot.progress.done}/${bot.progress.total}`;
  }, [bot]);

  const canGoBack = useMemo(() => {
    if (!bot) return false;
    if (bot.kind === "done") return false;
    return bot.progress.done > 0;
  }, [bot]);

  async function postChat(payload: any) {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await r.json()) as BotRes;
  }

  async function init() {
    const r = await postChat({ formId });
    setSessionId(r.sessionId);
    setBot(r);
    setMsgs([{ from: "bot", text: r.message }]);
  }

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing]);

  async function sendValue(v: string, opts?: { hideUserEcho?: boolean }) {
    if (!sessionId) return;

    if (!opts?.hideUserEcho) {
      setMsgs((m) => [...m, { from: "user", text: v }]);
    }

    setTyping(true);
    await sleep(250 + Math.random() * 450);

    const r = await postChat({ formId, sessionId, text: v });

    setTyping(false);
    setBot(r);
    setMsgs((m) => [...m, { from: "bot", text: r.message }]);
  }

  async function send() {
    const t = (text ?? "").trim();
    if (!t) return;
    setText("");
    await sendValue(t);
  }

  async function goBack() {
    if (!canGoBack) return;
    await sendValue("back", { hideUserEcho: true });
  }

  async function uploadFile(file: File) {
    if (!sessionId || !bot || bot.kind !== "ask") return;
    if (bot.input.type !== "file") return;

    setUploading(true);
    setTyping(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const url = `/api/upload?formId=${encodeURIComponent(formId)}&sessionId=${encodeURIComponent(
        sessionId
      )}&fieldId=${encodeURIComponent(bot.fieldId)}`;

      const r = await fetch(url, { method: "POST", body: fd });
      const next = (await r.json()) as BotRes;

      await sleep(250);

      setTyping(false);
      setBot(next);
      setMsgs((m) => [
        ...m,
        { from: "user", text: `Uploaded: ${file.name}` },
        { from: "bot", text: next.message },
      ]);
    } finally {
      setTyping(false);
      setUploading(false);
    }
  }

  async function submit() {
    if (!sessionId) return;

    setTyping(true);
    await sleep(300);

    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId, sessionId }),
    });

    const next = (await r.json()) as BotRes;

    setTyping(false);
    setBot(next);
    setMsgs((m) => [...m, { from: "bot", text: next.message }]);
  }

  const isAsk = bot?.kind === "ask";
  const isChoice = isAsk && bot.input.type === "choice";
  const isDate = isAsk && bot.input.type === "date";
  const isFile = isAsk && bot.input.type === "file";
  const isDone = bot?.kind === "done";

  return (
    <div style={{ maxWidth: 760, margin: "24px auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Form → Chat</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{progressLabel}</div>
        </div>

        <button
          onClick={goBack}
          disabled={!canGoBack || typing || uploading}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: !canGoBack || typing || uploading ? "not-allowed" : "pointer",
            opacity: !canGoBack || typing || uploading ? 0.5 : 1,
          }}
          title="Go back one step"
        >
          ← Back
        </button>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 16, padding: 16, minHeight: 420, background: "#fff" }}>
        {msgs.map((m, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              justifyContent: m.from === "user" ? "flex-end" : "flex-start",
              marginBottom: 10,
              gap: 8,
            }}
          >
            {m.from === "bot" && <BotAvatar />}

            <div
              style={{
                maxWidth: "75%",
                padding: "10px 14px",
                borderRadius: 18,
                background: m.from === "user" ? "#111" : "#f3f4f6",
                color: m.from === "user" ? "#fff" : "#111",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}

        {bot?.kind === "review" && (
          <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Review</div>
            <pre style={{ margin: 0, fontSize: 12, background: "#fafafa", padding: 10, borderRadius: 8, overflowX: "auto" }}>
              {JSON.stringify(bot.answers, null, 2)}
            </pre>
            <button
              onClick={submit}
              disabled={typing || uploading}
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                cursor: "pointer",
                opacity: typing || uploading ? 0.6 : 1,
              }}
            >
              Submit
            </button>
          </div>
        )}

        {typing && (
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <BotAvatar />
            <div style={{ padding: "10px 14px", borderRadius: 18, background: "#f3f4f6", display: "flex", gap: 6 }}>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <style jsx>{`
                .dot {
                  width: 6px;
                  height: 6px;
                  background: #9ca3af;
                  border-radius: 50%;
                  animation: blink 1.4s infinite both;
                }
                .dot:nth-child(2) {
                  animation-delay: 0.2s;
                }
                .dot:nth-child(3) {
                  animation-delay: 0.4s;
                }
                @keyframes blink {
                  0%,
                  80%,
                  100% {
                    opacity: 0.2;
                  }
                  40% {
                    opacity: 1;
                  }
                }
              `}</style>
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input area (hide once done) */}
      {!isDone && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {isChoice && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {bot.input.options.map((o) => (
                <button
                  key={o}
                  onClick={() => sendValue(o)}
                  disabled={typing || uploading}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                    opacity: typing || uploading ? 0.6 : 1,
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          {isDate && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                disabled={typing || uploading}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v) sendValue(v);
                  e.currentTarget.value = "";
                }}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd", width: 220 }}
              />
              <div style={{ fontSize: 12, opacity: 0.7 }}>Pick a date</div>
            </div>
          )}

          {isFile && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="file"
                accept={bot.input.accept}
                disabled={typing || uploading}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) uploadFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <div style={{ fontSize: 12, opacity: 0.7 }}>{uploading ? "Uploading..." : ""}</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={text ?? ""}
              onChange={(e) => setText(e.target.value ?? "")}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              placeholder={isFile ? "Upload the file above (or type a message)" : isDate ? "Or type a date like 2026-02-07" : 'Type your answer… ("restart")'}
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
              disabled={typing || uploading}
            />
            <button
              onClick={send}
              disabled={typing || uploading}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                cursor: "pointer",
                opacity: typing || uploading ? 0.6 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
        View submissions at <a href="/admin">/admin</a>
      </div>
    </div>
  );
}

