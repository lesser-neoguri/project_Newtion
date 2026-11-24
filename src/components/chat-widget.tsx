"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, Send, Trash2, X } from "lucide-react";
import { useWorkspace } from "./workspace-context";

type Scope = "page" | "tree" | "workspace";
interface Msg {
  role: "user" | "assistant";
  content: string;
  note?: string;
}

const SCOPES: { id: Scope; label: string; needsPage: boolean }[] = [
  { id: "page", label: "이 페이지", needsPage: true },
  { id: "tree", label: "이 페이지 + 하위", needsPage: true },
  { id: "workspace", label: "워크스페이스 전체", needsPage: false },
];

const SUGGESTIONS = [
  "이 문서를 3줄로 요약해줘",
  "아직 해결 안 된 Blocker 버그가 뭐야?",
  "이번 스프린트에서 진행 중인 작업 알려줘",
];

export function ChatWidget() {
  const { workspace, pageMap } = useWorkspace();
  const params = useParams<{ pageId?: string }>();
  const pageId = params.pageId ?? null;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("tree");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const effectiveScope: Scope = !pageId && scope !== "workspace" ? "workspace" : scope;
  const page = pageId ? pageMap.get(pageId) : undefined;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Lock background scroll while the full-screen sheet is open on phones.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(max-width: 639px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          workspaceId: workspace.id,
          pageId,
          scope: effectiveScope,
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        setMessages([...next, { role: "assistant", content: `⚠️ ${err || "요청에 실패했습니다."}` }]);
        return;
      }
      const skipped = Number(res.headers.get("X-Context-Skipped") || 0);
      const pagesUsed = Number(res.headers.get("X-Context-Pages") || 0);
      const note = `문서 ${pagesUsed}개 참고${skipped ? ` · 용량 제한으로 ${skipped}개 제외` : ""}`;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc, note }]);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages([...next, { role: "assistant", content: "⚠️ 네트워크 오류가 발생했습니다." }]);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="문서 도우미"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[90] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition hover:scale-105 hover:shadow-xl active:scale-95"
        >
          <Bot size={26} />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[95] flex flex-col bg-background sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100dvh-2rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Bot size={20} className="text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">문서 도우미</div>
              <div className="truncate text-xs text-muted">
                {effectiveScope === "workspace"
                  ? `${workspace.icon} ${workspace.name} 전체`
                  : `${page?.icon ?? "📄"} ${page?.title || "제목 없음"}${effectiveScope === "tree" ? " + 하위" : ""}`}
              </div>
            </div>
            {messages.length > 0 && (
              <button title="대화 지우기" onClick={() => { abortRef.current?.abort(); setMessages([]); }} className="rounded p-1.5 text-muted hover:bg-hover">
                <Trash2 size={16} />
              </button>
            )}
            <button title="닫기" onClick={() => setOpen(false)} className="rounded p-1.5 text-muted hover:bg-hover">
              <X size={18} />
            </button>
          </div>

          {/* Scope selector */}
          <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
            {SCOPES.map((s) => {
              const disabled = s.needsPage && !pageId;
              return (
                <button
                  key={s.id}
                  disabled={disabled}
                  onClick={() => setScope(s.id)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                    effectiveScope === s.id ? "bg-accent text-white" : "bg-hover text-foreground/80"
                  } disabled:opacity-40`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Messages */}
          <div ref={listRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3 pt-4 text-center">
                <div className="text-3xl">🤖</div>
                <p className="text-sm text-muted">선택한 범위의 문서를 읽고 답해 드려요.</p>
                <div className="flex flex-col gap-2 pt-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-hover">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user" ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm bg-hover"
                  }`}
                >
                  {m.content || (busy && i === messages.length - 1 ? <TypingDots /> : "")}
                  {m.note && m.content && <div className="mt-1.5 text-[11px] text-muted">{m.note}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
            className="flex items-end gap-2 border-t border-line p-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="문서에 대해 물어보세요…"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-transparent px-3 py-2 text-base outline-none focus:border-accent sm:text-sm"
            />
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="h-10 shrink-0 rounded-xl border border-line px-3 text-sm hover:bg-hover">
                중지
              </button>
            ) : (
              <button disabled={!input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white disabled:opacity-40">
                <Send size={16} />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-60" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
