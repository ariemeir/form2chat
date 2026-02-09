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

async function postJson<T>(path: string, body: any): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as T;
}

export default function DemoPage(props: any) {
  // --- existing props / params behavior preserved ---
  const token = props?.candidateToken as string | undefined;

  const [formId, setFormId] = useState<string>(() => {
    return props?.candidateToken ? "reference" : "demo";
  });

  const [candidateToken, setCandidateToken] = useState<string | null>(
    props?.candidateToken ?? null
  );

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bot, setBot] = useState<ChatResponse | null>(null);
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);

  const [restartNonce, setRestartNonce] = useState(0);

  const [showCollected, setShowCollected] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isCandidateFlow = !!candidateToken;

  function appendTyping() {
    setThread((prev) => [...prev, { id: uid(), role: "typing" }]);
  }

  function replaceTypingWithAgent(text: string) {
    setThread((prev) => {
      const withoutTyping = prev.filter((m) => m.role !== "typing");
      return [...withoutTyping, { id: uid(), role: "agent", text }];
    });
  }

  // scroll to bottom when thread changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.length, showCollected]);

  // --- start conversation on load (existing logic preserved) ---
  useEffect(() => {
    let cancelled = false;

    async function start() {
      setError(null);
      setThread([]);
      setBot(null);
      setSessionId(null);

      setIsSending(true);
      appendTyping();

      try {
        const r = await postJson<ChatResponse>("/api/chat/start", {
          formId,
          candidateToken: candidateToken ?? null,
        });

        if (cancelled) return;

        setSessionId(r.sessionId);
        setBot(r);

        await sleep(randomDelay(r.kind));
        replaceTypingWithAgent(r.message);
      } catch (e: any) {
        if (cancelled) return;
        setThread((prev) => prev.filter((m) => m.role !== "typing"));
        setError(e?.message ?? "Failed to start");
      } finally {
        if (!cancelled) setIsSending(false);
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

  type SubmitResponse = {
    success: boolean;
    references_created?: number;
    error?: string;
  };

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
      refs.length > 0 ? refs : draft && Object.keys(draft).length > 0 ? [draft] : [];

    try {
      const body = isCandidateFlow
        ? {
            formId: "candidate",
            sessionId: sid,
            candidateToken: token ?? null,
            references,
          }
        : {
            formId,
            sessionId: sid,
            candidateToken: token ?? null,
            answers,
          };

      const r = await postJson<SubmitResponse>("/api/submit", body);

      if (!r.success) {
        throw new Error(r.error ?? "Submit failed");
      }

      replaceTypingWithAgent(`Submitted. References created: ${r.references_created ?? 0}`);
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
    Array.isArray((bot.input as any).options);

  const showFileUpload = bot?.kind === "ask" && bot.input?.type === "file";

  // Auto-focus after agent asks a question (keeps it “texting-like”)
  useEffect(() => {
    if (isSending) return;
    if (showFileUpload) return;
    if (!bot || bot.kind !== "ask") return;

    const last = thread[thread.length - 1];
    if (!last || last.role !== "agent") return;

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [bot?.kind, bot?.kind === "ask" ? bot.fieldId : undefined, bot?.sessionId, isSending, showFileUpload, thread.length]);

  // Derived “collected so far” (kept as-is)
  const collected: { question: string; answer: string }[] = useMemo(() => {
    const answers = (bot as any)?.answers_json ?? {};
    const pairs: { question: string; answer: string }[] = [];
    if (answers && typeof answers === "object") {
      for (const [k, v] of Object.entries(answers)) {
        if (k.startsWith("__")) continue;
        pairs.push({ question: k, answer: String(v ?? "") });
      }
    }
    return pairs;
  }, [bot]);

  return (
    <div className="chatPage">
      <style>{`
        @keyframes dotFade {
          0% { opacity: 0.2; transform: translateY(0px); }
          20% { opacity: 0.9; transform: translateY(-1px); }
          40% { opacity: 0.2; transform: translateY(0px); }
          100% { opacity: 0.2; }
        }

        /* Mobile-first: full-bleed chat surface */
        .chatPage {
          height: 100dvh;
          width: 100%;
          max-wdith: 100%;
	  background: #fff;
          overflow-x: hidden;
          overflow: hidden; /* prevent sideways “grab” feeling */
        }

        .chatShell {
          height: 100dvh;
          width: 100%;
	  max-width: 100%;
          display: flex;
          flex-direction: column;
          background: #fff;
          overflow-x: hidden;
          overflow: hidden;
        }

        /* Desktop: bring back “card” if you want it */
        @media (min-width: 900px) {
          .chatPage {
            background: #f7f7f7;
            display: flex;
            justify-content: center;
            padding: 24px;
          }
          .chatShell {
            width: min(860px, 100%);
            height: min(86vh, 880px);
            border-radius: 18px;
            box-shadow: 0 6px 30px rgba(0,0,0,0.06);
            border: 1px solid rgba(0,0,0,0.04);
          }
        }
      `}</style>

      <div className="chatShell" style={styles.shell}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.avatar}>A</div>
            <div style={{ minWidth: 0 }}>
              <div style={styles.title}>Reference Chat</div>
              <div style={styles.subtle}>{progressText ? `Progress ${progressText}` : ""}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowCollected((v) => !v)}
              style={styles.smallBtn}
              disabled={collected.length === 0}
            >
              {showCollected ? "Hide" : "Collected"}
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

        {/* Sticky composer: makes it feel like texting */}
        <div style={styles.footer}>
          {isReview ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => void submit()} style={styles.sendBtn} disabled={isSending}>
                Submit
              </button>

              {!isCandidateFlow && (
                <button type="button" onClick={restartFromBeginning} style={styles.smallBtn} disabled={isSending}>
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
              <button type="submit" style={styles.sendBtn} disabled={isSending || !input.trim()}>
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
  shell: {
    // kept for structure; actual sizing is controlled by .chatShell CSS above
    display: "flex",
    flexDirection: "column",
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
    minWidth: 0,
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
    flex: "0 0 auto",
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
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  subtle: {
    fontSize: 12,
    color: "#666",
  },
  thread: {
    flex: 1,
    padding: 16,
    overflowY: "auto",
    overflowX: "hidden", // critical: kill horizontal drift inside thread
    background: "#fafafa",
    WebkitOverflowScrolling: "touch",
  },
  agentRow: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 10,
    minWidth: 0,
  },
  userRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 10,
    minWidth: 0,
  },
  agentBubble: {
    background: "#fff",
    border: "1px solid #eee",
    borderRadius: 14,
    padding: "10px 12px",
    maxWidth: "78%",
    fontSize: 14,
    lineHeight: 1.35,
    color: "#111",
    overflowWrap: "anywhere", // break long URLs/tokens
    wordBreak: "break-word",
    minWidth: 0,
  },
  userBubble: {
    background: "#fff",
    borderRadius: 14,
    padding: "10px 12px",
    maxWidth: "78%",
    fontSize: 14,
    lineHeight: 1.35,
    color: "#111",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    minWidth: 0,
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
    maxHeight: 160,
    overflowY: "auto",
    overflowX: "hidden",
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
    overflowWrap: "anywhere",
  },
  collectedA: {
    fontSize: 13,
    color: "#111",
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  footer: {
    display: "flex",
    gap: 10,
    padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
    borderTop: "1px solid #eee",
    background: "#fff",
    position: "sticky",
    bottom: 0,
    zIndex: 10,
  },
  form: {
    display: "flex",
    gap: 10,
    width: "100%",
    minWidth: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    border: "1px solid #ddd",
    borderRadius: 999,
    padding: "10px 12px",
    fontSize: 14,
    color: "#111",
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
    flex: "0 0 auto",
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
    overflowWrap: "anywhere",
  },
};

