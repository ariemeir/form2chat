"use client";

import { useEffect, useMemo, useState } from "react";

type ChatResponse =
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
      answers: any;
      progress: { done: number; total: number };
    }
  | {
      kind: "done";
      sessionId: string;
      message: string;
    };

type InputHint =
  | { type: "text" }
  | { type: "number" }
  | { type: "date" }
  | { type: "file"; accept?: string }
  | { type: "choice"; options: string[] };

export default function DemoPage() {
  const [bot, setBot] = useState<ChatResponse | null>(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);

  // Start conversation
  useEffect(() => {
    start();
  }, []);

  async function start() {
    const res = await fetch("/api/chat/start?formId=demo");
    const data = await res.json();
    setBot(data);
  }

  async function sendValue(value: string) {
    if (!bot || bot.kind === "done") return;

    setTyping(true);

    const res = await fetch("/api/chat/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        formId: "demo",
        sessionId: bot.sessionId,
        text: value,
      }),
    });

    const data = await res.json();

    setTimeout(() => {
      setBot(data);
      setText("");
      setTyping(false);
    }, 400); // small delay for realism
  }

  async function goBack() {
    if (!bot || bot.kind === "done") return;

    const res = await fetch("/api/chat/message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        formId: "demo",
        sessionId: bot.sessionId,
        text: "back",
      }),
    });

    const data = await res.json();
    setBot(data);
  }

  async function submit() {
    if (!bot) return;

    const res = await fetch("/api/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        formId: "demo",
        sessionId: bot.sessionId,
      }),
    });

    const data = await res.json();
    setBot(data);
  }

  const progressLabel = useMemo(() => {
    if (!bot || bot.kind === "done") return "";
    if (!("progress" in bot)) return "";
    return `${bot.progress.done}/${bot.progress.total}`;
  }, [bot]);

  // ✅ SAFE type narrowing
  const isChoice =
    bot?.kind === "ask" && bot.input.type === "choice";

  const choiceOptions =
    bot?.kind === "ask" && bot.input.type === "choice"
      ? bot.input.options
      : [];

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "40px auto",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
      }}
    >
      {/* progress */}
      {progressLabel && (
        <div style={{ marginBottom: 12, fontSize: 12, opacity: 0.6 }}>
          Progress: {progressLabel}
        </div>
      )}

      {/* bot bubble */}
      {bot && (
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            background: "#f3f4f6",
            marginBottom: 16,
          }}
        >
          {bot.message}
        </div>
      )}

      {/* typing indicator */}
      {typing && (
        <div style={{ marginBottom: 16, opacity: 0.6 }}>
          ● ● ●
        </div>
      )}

      {/* choices */}
      {isChoice && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {choiceOptions.map((o) => (
            <button
              key={o}
              onClick={() => sendValue(o)}
              style={{
                padding: "10px 12px",
                borderRadius: 999,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}

      {/* text input */}
      {bot?.kind === "ask" && bot.input.type !== "choice" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={text ?? ""}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                sendValue(text);
              }
            }}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          />

          <button
            onClick={() => sendValue(text)}
            style={{
              padding: "0 16px",
              borderRadius: 10,
              border: "none",
              background: "#111",
              color: "white",
              cursor: "pointer",
            }}
          >
            Send
          </button>
        </div>
      )}

      {/* review */}
      {bot?.kind === "review" && (
        <div style={{ marginTop: 16 }}>
<div
  style={{
    background: "#fafafa",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #eee",
    fontSize: 12,
  }}
>
  {(bot.answers?.references ?? []).map((ref: any, idx: number) => (
    <div key={idx} style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Reference {idx + 1}
      </div>

      {/* NOTE: this displays keys in object insertion order (can vary). */}
      {Object.entries(ref).map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 8 }}>
          <div style={{ minWidth: 180, color: "#444" }}>{k}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{String(v ?? "")}</div>
        </div>
      ))}
    </div>
  ))}
</div>
          <button
            onClick={submit}
            style={{
              marginTop: 12,
              padding: "10px 16px",
              borderRadius: 10,
              border: "none",
              background: "#111",
              color: "white",
              cursor: "pointer",
            }}
          >
            Submit
          </button>
        </div>
      )}

      {/* back button */}
      {bot?.kind === "ask" && (
        <button
          onClick={goBack}
          style={{
            marginTop: 10,
            fontSize: 12,
            opacity: 0.6,
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>
      )}

      {/* done */}
      {bot?.kind === "done" && (
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            background: "#ecfeff",
            marginTop: 16,
          }}
        >
          {bot.message}
        </div>
      )}
    </div>
  );
}

