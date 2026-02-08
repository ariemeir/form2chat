"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type InputHint =
  | { type: "text" }
  | { type: "number" }
  | { type: "date" }
  | { type: "choice"; options: string[] }
  | { type: "file"; accept?: string };

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
  | { kind: "done"; sessionId: string; message: string };

type ThreadMsg =
  | { id: string; role: "agent"; text: string }
  | { id: string; role: "user"; text: string }
  | { id: string; role: "typing" };

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(kind: ChatResponse["kind"]) {
  const base = kind === "review" ? 700 : kind === "done" ? 450 : 350;
  const jitter = 450;
  return base + Math.floor(Math.random() * jitter);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function deriveCollected(thread: ThreadMsg[]) {
  const pairs: Array<{ question: string; answer: string }> = [];
  let pendingQuestion: string | null = null;

  for (const m of thread) {
    if (m.role === "agent") {
      pendingQuestion = m.text;
    } else if (m.role === "user") {
      if (pendingQuestion) {
        pairs.push({ question: pendingQuestion, answer: m.text });
        pendingQuestion = null;
      }
    }
  }

  return pairs;
}

async function postJson<T>(path: string, body: any): Promise<T> {
  const url =
    typeof window !== "undefined"
      ? new URL(path, window.location.origin).toString()
      : path;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text) as T;
}

export default function DemoPage({
  candidateToken,
}: {
  candidateToken?: string;
}) {
  const isCandidateFlow = !!candidateToken;

  const sendingRef = useRef(false);
  const [formId, setFormId] = useState<string>("demo");

  const [bot, setBot] = useState<ChatResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [input, setInput] = useState<string>("");

  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCollected, setShowCollected] = useState(false);
  const [restartNonce, setRestartNonce] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const collected = useMemo(() => deriveCollected(thread), [thread]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [thread.length]);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const qForm = u.searchParams.get("formId");
      if (qForm) setFormId(qForm);
    } catch {
      // ignore
    }
  }, []);

  function replaceTypingWithAgent(text: string) {
    setThread((prev) => {
      const withoutTyping = prev.filter((m) => m.role !== "typing");
      return [...withoutTyping, { id: uid(), role: "agent", text }];
    });
  }

  function appendTyping() {
    setThread((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].role === "typing") return prev;
      return [...prev, { id: uid(), role: "typing" }];
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setError(null);
      setIsSending(true);
      setThread([]);
      setBot(null);
      setSessionId(null);
      setShowCollected(false);
      setInput("");

      setThread([{ id: uid(), role: "typing" }]);

      try {
        const r = await postJson<ChatResponse>("/api/chat/start", {
          formId,
          candidateToken: candidateToken ?? null,
        });
        if (cancelled) return;

        setSessionId(r.sessionId);
        setBot(r);

        await sleep(randomDelay(r.kind));
        if (cancelled) return;

        setThread((prev) => {
          const withoutTyping = prev.filter((m) => m.role !== "typing");
          const next: ThreadMsg[] = [...withoutTyping];
          next.push({ id: uid(), role: "agent", text: r.message });
          return next;
        });
      } catch (e: any) {
        if (cancelled) return;
        setThread((prev) => prev.filter((m) => m.role !== "typing"));
        setError(e?.message ?? "Failed to start chat");
      } finally {
        if (!cancelled) {
          sendingRef.current = false;
          setIsSending(false);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [formId, restartNonce, candidateToken]);

  function restartFromBeginning() {
    setRestartNonce((n) => n + 1);
  }

  async function submit() {
    const sid = sessionId ?? bot?.sessionId;
    if (!sid) return;

    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setError(null);

    setThread((prev) => [...prev, { id: uid(), role: "user", text: "Submit" }]);
    appendTyping();

    const answers = (bot as any)?.answers_json;
    const refs = answers?.__refs ?? [];
    const draft = answers?.__draft ?? null;

    const references =
      refs.length > 0
	? refs
	: draft && Object.keys(draft).length > 0
	  ? [draft]
	  : [];

    try {
      const r = await postJson<ChatResponse>("/api/submit", {
        formId,
        sessionId: sid,
        candidateToken: candidateToken ?? null,
	references,
      });

      setSessionId(r.sessionId);
      setBot(r);

      await sleep(randomDelay(r.kind));
      replaceTypingWithAgent(r.message);
    } catch (e: any) {
      setThread((prev) => prev.filter((m) => m.role !== "typing"));
      setError(e?.message ?? "Failed to submit");
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  async function sendText(text: string) {
    const sid = sessionId ?? bot?.sessionId;
    if (!sid) return;

    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setError(null);

    setThread((prev) => [...prev, { id: uid(), role: "user", text }]);
    appendTyping();

    try {
      const r = await postJson<ChatResponse>("/api/chat/message", {
        formId,
        sessionId: sid,
        text,
        candidateToken: candidateToken ?? null,
      });

      setSessionId(r.sessionId);
      setBot(r);

      await sleep(randomDelay(r.kind));
      replaceTypingWithAgent(r.message);
    } catch (e: any) {
      setThread((prev) => prev.filter((m) => m.role !== "typing"));
      setError(e?.message ?? "Failed to send message");
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput("");
    void sendText(t);
  }

  const progressText = useMemo(() => {
    const p = bot && "progress" in bot ? (bot as any).progress : null;
    if (!p) return null;
    const done = clamp(p.done, 0, p.total);
    return `${done}/${p.total}`;
  }, [bot]);

  const isReview = bot?.kind === "review";
  const isDone = bot?.kind === "done";

  const showChoiceButtons =
    bot?.kind === "ask" &&
    bot.input?.type === "choice" &&
    Array.isArray(bot.input.options);

  const showFileUpload = bot?.kind === "ask" && bot.input?.type === "file";

  useEffect(() => {
    if (isSending) return;
    if (showFileUpload) return;
    if (!bot || bot.kind !== "ask") return;

    const last = thread[thread.length - 1];
    if (!last || last.role !== "agent") return;

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [bot?.kind, (bot as any)?.fieldId, bot?.sessionId, isSending, showFileUpload, thread.length]);

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes dotFade {
          0% { opacity: 0.2; transform: translateY(0px); }
          20% { opacity: 0.9; transform: translateY(-1px); }
          40% { opacity: 0.2; transform: translateY(0px); }
          100% { opacity: 0.2; }
        }
      `}</style>

      <div style={styles.shell}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.avatar}>A</div>
            <div>
              <div style={styles.title}>Reference Chat</div>
              <div style={styles.subtle}>
                {progressText ? `Progress ${progressText}` : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowCollected((v) => !v)}
              style={styles.smallBtn}
              disabled={collected.length === 0}
            >
              {showCollected ? "Hide collected" : "Show collected"}
            </button>

            <button
              type="button"
              onClick={() => void sendText("back")}
              style={styles.smallBtn}
              disabled={isSending}
            >
              Back
            </button>

            {!isCandidateFlow && (
              <button
                type="button"
                onClick={restartFromBeginning}
                style={styles.smallBtn}
                disabled={isSending}
              >
                Restart
              </button>
            )}
          </div>
        </div>

        {showCollected && collected.length > 0 && (
          <div style={styles.collected}>
            <div style={styles.collectedTitle}>Collected so far</div>
            <div style={styles.collectedList}>
              {collected.slice(-8).map((p, idx) => (
                <div key={idx} style={styles.collectedRow}>
                  <div style={styles.collectedQ}>{p.question}</div>
                  <div style={styles.collectedA}>{p.answer}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={scrollRef} style={styles.thread}>
          {thread.map((m) => {
            if (m.role === "typing") {
              return (
                <div key={m.id} style={styles.agentRow}>
                  <div style={styles.avatarSmall}>A</div>
                  <div style={styles.agentBubble}>
                    <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                    <span style={{ ...styles.dot, animationDelay: "140ms" }} />
                    <span style={{ ...styles.dot, animationDelay: "280ms" }} />
                  </div>
                </div>
              );
            }

            if (m.role === "agent") {
              return (
                <div key={m.id} style={styles.agentRow}>
                  <div style={styles.avatarSmall}>A</div>
                  <div style={styles.agentBubble}>{m.text}</div>
                </div>
              );
            }

            return (
              <div key={m.id} style={styles.userRow}>
                <div style={styles.userBubble}>{m.text}</div>
              </div>
            );
          })}

          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          {isReview ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => void submit()}
                style={styles.sendBtn}
                disabled={isSending}
              >
                Submit
              </button>

              {!isCandidateFlow && (
                <button
                  type="button"
                  onClick={restartFromBeginning}
                  style={styles.smallBtn}
                  disabled={isSending}
                >
                  Restart
                </button>
              )}
            </div>
          ) : isDone ? (
            <div style={styles.subtle}>Done</div>
          ) : showChoiceButtons ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {bot?.kind === "ask" &&
                bot.input.type === "choice" &&
                bot.input.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    style={styles.smallBtn}
                    onClick={() => void sendText(opt)}
                    disabled={isSending}
                  >
                    {opt}
                  </button>
                ))}
            </div>
          ) : showFileUpload ? (
            <div style={styles.subtle}>File upload not wired yet.</div>
          ) : (
            <form onSubmit={onSubmit} style={styles.form}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isSending}
                placeholder="Type your reply…"
                style={styles.input}
              />
              <button
                type="submit"
                style={styles.sendBtn}
                disabled={isSending || !input.trim()}
              >
                Send
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#f7f7f7",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    padding: 24,
  },
  shell: {
    width: "min(860px, 100%)",
    background: "#fff",
    borderRadius: 18,
    boxShadow: "0 6px 30px rgba(0,0,0,0.06)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    height: "min(86vh, 880px)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    padding: "14px 16px",
    borderBottom: "1px solid #eee",
    background: "#fff",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    background: "#111",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
  },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 999,
    background: "#111",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
    fontSize: 12,
    flex: "0 0 auto",
    marginTop: 2,
  },
  title: {
    fontWeight: 800,
    fontSize: 14,
  },
  subtle: {
    fontSize: 12,
    color: "#666",
  },
  thread: {
    flex: 1,
    padding: 16,
    overflowY: "auto",
    background: "#fafafa",
  },
  agentRow: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 10,
  },
  userRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 10,
  },
  agentBubble: {
    background: "#fff",
    border: "1px solid #eee",
    borderRadius: 14,
    padding: "10px 12px",
    maxWidth: "78%",
    fontSize: 14,
    lineHeight: 1.35,
  },
  userBubble: {
    background: "#111",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 12px",
    maxWidth: "78%",
    fontSize: 14,
    lineHeight: 1.35,
  },
  dot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#999",
    marginRight: 6,
    animation: "dotFade 1.2s infinite ease-in-out",
  },
  collected: {
    borderBottom: "1px solid #eee",
    background: "#fff",
    padding: "10px 16px",
  },
  collectedTitle: {
    fontSize: 12,
    fontWeight: 800,
    marginBottom: 8,
    color: "#333",
  },
  collectedList: {
    display: "grid",
    gap: 8,
  },
  collectedRow: {
    display: "grid",
    gap: 2,
    padding: "8px 10px",
    borderRadius: 12,
    background: "#f7f7f7",
    border: "1px solid #eee",
  },
  collectedQ: {
    fontSize: 12,
    color: "#666",
  },
  collectedA: {
    fontSize: 13,
    color: "#111",
    fontWeight: 700,
  },
  footer: {
    display: "flex",
    gap: 10,
    padding: 12,
    borderTop: "1px solid #eee",
    background: "#fff",
  },
  form: {
    display: "flex",
    gap: 10,
    width: "100%",
  },
  input: {
    flex: 1,
    border: "1px solid #ddd",
    borderRadius: 999,
    padding: "10px 12px",
    fontSize: 14,
    outline: "none",
  },
  sendBtn: {
    border: "none",
    background: "#111",
    color: "#fff",
    borderRadius: 999,
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  smallBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
    color: "#111",
  },
  error: {
    margin: "0 12px 12px",
    padding: "10px 12px",
    borderRadius: 12,
    background: "#fff2f2",
    border: "1px solid #ffd0d0",
    color: "#a10000",
    fontSize: 13,
  },
};

