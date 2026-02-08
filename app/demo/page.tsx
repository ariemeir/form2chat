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
  // tuned to feel human without being annoying
  const base =
    kind === "review" ? 700 :
    kind === "done" ? 450 :
    350;

  const jitter = 450; // +/- range
  return base + Math.floor(Math.random() * jitter);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Derive "Collected so far" from the chat transcript:
 * - We pair each agent prompt with the subsequent user reply.
 * - Works even if backend doesn't return draft answers yet.
 */
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

  // HARD normalize URL to same-origin
  const url =
    typeof window !== "undefined"
      ? new URL(path, window.location.origin).toString()
      : path;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text) as T;
}


export default function DemoPage() {
  const sendingRef = useRef(false);
  const [formId, setFormId] = useState<string>("demo");

  const [bot, setBot] = useState<ChatResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [input, setInput] = useState<string>("");

  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCollected, setShowCollected] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);

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

      setThread([{ id: uid(), role: "typing" }]);

      try {
        const r = await postJson<ChatResponse>("/api/chat/start", { formId });
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
        if (!cancelled) 
        {
          sendingRef.current = false;
 	  setIsSending(false);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
    };
  }, [formId]);

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

  async function uploadFile(file: File) {
    const sid = sessionId ?? bot?.sessionId;
    if (!sid) return;
    if (!bot || bot.kind !== "ask") return;

    if (isSending) return;
    setIsSending(true);
    setError(null);

    setThread((prev) => [...prev, { id: uid(), role: "user", text: `Uploaded: ${file.name}` }]);
    appendTyping();

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("formId", formId);
      fd.append("sessionId", sid);
      fd.append("fieldId", bot.fieldId);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} /api/upload: ${text.slice(0, 200)}`);
      }

      const r = JSON.parse(text) as ChatResponse;

      setSessionId(r.sessionId);
      setBot(r);

      await sleep(randomDelay(r.kind));
      replaceTypingWithAgent(r.message);
    } catch (e: any) {
      setThread((prev) => prev.filter((m) => m.role !== "typing"));
      setError(e?.message ?? "Failed to upload file");
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

  const showChoiceButtons = bot?.kind === "ask" && bot.input?.type === "choice" && Array.isArray(bot.input.options);
  const showFileUpload = bot?.kind === "ask" && bot.input?.type === "file";
  const showReviewButtons = bot?.kind === "review";

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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.agentAvatar}>A</div>
            <div>
              <div style={styles.title}>Reference Chat</div>
              <div style={styles.subtle}>
                {progressText ? `Progress ${progressText}` : " "}
                {sessionId ? ` • Session ${sessionId.slice(0, 8)}…` : ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setShowCollected((v) => !v)}
              style={styles.smallBtn}
              disabled={collected.length === 0}
              title="Toggle collected so far"
            >
              {showCollected ? "Hide collected" : "Show collected"}
            </button>

            <button type="button" onClick={() => void sendText("back")} style={styles.smallBtn} disabled={isSending}>
              Back
            </button>

            <button type="button" onClick={() => void sendText("restart")} style={styles.smallBtn} disabled={isSending}>
              Restart
            </button>
          </div>
        </div>

        {showCollected && collected.length > 0 && (
          <div style={styles.collectedPanel}>
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
          {thread.map((m, index) => {
            const isLast = index === thread.length - 1;

            if (m.role === "typing") {
              return (
                <div key={m.id} style={styles.rowLeft}>
                  <div style={styles.avatarColumn}>
                    <div style={styles.agentAvatarSmall}>A</div>
                  </div>
                  <div style={styles.bubbleAgent}>
                    <span style={{ ...styles.typingDot, animationDelay: "0ms" }} />
                    <span style={{ ...styles.typingDot, animationDelay: "140ms" }} />
                    <span style={{ ...styles.typingDot, animationDelay: "280ms" }} />
                  </div>
                </div>
              );
            }

            if (m.role === "agent") {
              return (
                <div key={m.id} style={styles.rowLeft}>
                  <div style={styles.avatarColumn}>
                    <div style={styles.agentAvatarSmall}>A</div>
                  </div>
                  <div style={styles.bubbleAgent}>
                    <div style={styles.bubbleText}>{m.text}</div>

                    {/* Choices for ask */}
                    {showChoiceButtons && isLast && (
                      <div style={styles.choices}>
                        {bot!.kind === "ask" &&
                          bot!.input.type === "choice" &&
                          bot!.input.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => void sendText(opt)}
                              style={styles.choiceBtn}
                              disabled={isSending}
                            >
                              {opt}
                            </button>
                          ))}
                      </div>
                    )}

                    {/* Upload for file */}
                    {showFileUpload && isLast && (
                      <div style={styles.uploadRow}>
                        <label style={styles.uploadLabel}>
                          <input
                            type="file"
                            accept={bot.kind === "ask" && bot.input.type === "file" ? (bot.input.accept ?? "*/*") : "*/*"}
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              e.currentTarget.value = "";
                              void uploadFile(f);
                            }}
                            disabled={isSending}
                          />
                          Upload file
                        </label>
                        <div style={styles.subtle}>
                          {bot.kind === "ask" && bot.input.type === "file" && bot.input.accept ? `Accepted: ${bot.input.accept}` : ""}
                        </div>
                      </div>
                    )}

                    {/* YES/NO buttons for review */}
                    {showReviewButtons && isLast && (
                      <div style={styles.choices}>
                        <button type="button" onClick={() => void sendText("yes")} style={styles.choiceBtn} disabled={isSending}>
                          Yes, submit
                        </button>
                        <button type="button" onClick={() => void sendText("no")} style={styles.choiceBtn} disabled={isSending}>
                          No, edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} style={styles.rowRight}>
                <div style={styles.bubbleUser}>
                  <div style={styles.bubbleText}>{m.text}</div>
                </div>
              </div>
            );
          })}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={onSubmit} style={styles.composer}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              bot?.kind === "done"
                ? "Done"
                : showFileUpload
                ? "Use Upload file above"
                : showChoiceButtons
                ? "Tap an option above or type…"
                : showReviewButtons
                ? "Type YES to submit or NO to edit…"
                : "Type your reply…"
            }
            style={styles.input}
            disabled={isSending || bot?.kind === "done" || showFileUpload}
            autoComplete="off"
          />
          <button
            type="submit"
            style={{
              ...styles.sendBtn,
              opacity: isSending || bot?.kind === "done" || showFileUpload ? 0.5 : 1,
              cursor: isSending || bot?.kind === "done" || showFileUpload ? "not-allowed" : "pointer",
            }}
            disabled={isSending || bot?.kind === "done" || showFileUpload}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f5f6f8",
    display: "flex",
    justifyContent: "center",
    padding: 16,
  },
  shell: {
    width: "100%",
    maxWidth: 860,
    background: "#fff",
    border: "1px solid #e7e8ea",
    borderRadius: 16,
    boxShadow: "0 6px 24px rgba(0,0,0,0.06)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: "calc(100vh - 32px)",
  },
  header: {
    padding: "14px 16px",
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  title: { fontSize: 16, fontWeight: 700, lineHeight: 1.2 },
  subtle: { fontSize: 12, color: "#666" },

  agentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    background: "#111",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
  },
  agentAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 999,
    background: "#111",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 12,
  },
  avatarColumn: { width: 36, display: "flex", justifyContent: "center" },

  collectedPanel: {
    borderBottom: "1px solid #eee",
    background: "#fafafa",
    padding: "10px 16px",
  },
  collectedTitle: { fontSize: 12, fontWeight: 700, color: "#444", marginBottom: 8 },
  collectedList: { display: "flex", flexDirection: "column", gap: 8 },
  collectedRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  collectedQ: { fontSize: 12, color: "#555" },
  collectedA: { fontSize: 12, color: "#111", wordBreak: "break-word" },

  thread: {
    flex: 1,
    padding: "16px 12px",
    overflowY: "auto",
    background: "#ffffff",
  },
  rowLeft: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 12,
  },
  rowRight: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 12,
  },
  bubbleAgent: {
    maxWidth: "72%",
    background: "#f2f3f5",
    border: "1px solid #e7e8ea",
    borderRadius: 16,
    padding: "10px 12px",
  },
  bubbleUser: {
    maxWidth: "72%",
    background: "#111",
    color: "#fff",
    borderRadius: 16,
    padding: "10px 12px",
  },
  bubbleText: {
    whiteSpace: "pre-wrap",
    fontSize: 14,
    lineHeight: 1.35,
  },

  typingDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: 99,
    background: "#666",
    marginRight: 6,
    animationName: "dotFade",
    animationDuration: "900ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },

  choices: {
    marginTop: 10,
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
  },

  uploadRow: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  uploadLabel: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
  },

  composer: {
    display: "flex",
    gap: 10,
    padding: 12,
    borderTop: "1px solid #eee",
    background: "#fff",
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

