"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, CircleX, Info, Play, RotateCcw, Terminal, X,
} from "lucide-react";
import type { BlockNoteEditor } from "./editor";
import { diffLines, withContext, type DiffRow } from "@/lib/line-diff";
import type { TidyMode, TidyResultT } from "@/app/api/tidy/route";

type Phase = "idle" | "running" | "result" | "applied" | "error";
type Note = TidyResultT["notes"][number];
interface Result extends TidyResultT {
  model: string;
  usage: { input: number; output: number };
}
interface LogLine { kind: "cmd" | "info" | "ok" | "err" | "dim"; text: string }

const MODES: { id: TidyMode; label: string; flag: string }[] = [
  { id: "tidy", label: "전체 정리", flag: "--all" },
  { id: "proofread", label: "맞춤법·문장", flag: "--proofread" },
  { id: "structure", label: "구조 개선", flag: "--structure" },
];

const SEV = {
  error: { icon: CircleX, cls: "text-red-400", label: "error" },
  warning: { icon: AlertTriangle, cls: "text-yellow-400", label: "warning" },
  info: { icon: Info, cls: "text-sky-400", label: "info" },
} as const;

export function TidyPanel({
  editor, pageId, pageTitle, onClose,
}: {
  editor: BlockNoteEditor | null;
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<TidyMode>("tidy");
  const [instruction, setInstruction] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [original, setOriginal] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<"output" | "diff" | "problems">("output");
  const [showAll, setShowAll] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const log = (kind: LogLine["kind"], text: string) => setLogs((l) => [...l, { kind, text }]);

  // Elapsed timer while running
  useEffect(() => {
    if (phase !== "running") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const diff = useMemo(() => (result ? diffLines(original, result.markdown) : []), [original, result]);
  const stats = useMemo(() => ({
    add: diff.filter((d) => d.type === "add").length,
    del: diff.filter((d) => d.type === "del").length,
  }), [diff]);
  const rows: DiffRow[] = useMemo(() => (showAll ? diff : withContext(diff, 3)), [diff, showAll]);
  const notesByLine = useMemo(() => {
    const m = new Map<number, Note[]>();
    for (const n of result?.notes ?? []) {
      if (n.line > 0) m.set(n.line, [...(m.get(n.line) ?? []), n]);
    }
    return m;
  }, [result]);
  const counts = useMemo(() => ({
    error: result?.notes.filter((n) => n.severity === "error").length ?? 0,
    warning: result?.notes.filter((n) => n.severity === "warning").length ?? 0,
    info: result?.notes.filter((n) => n.severity === "info").length ?? 0,
  }), [result]);

  async function run() {
    if (!editor) return;
    const md = editor.blocksToMarkdownLossy(editor.document).trimEnd();
    const flag = MODES.find((m) => m.id === mode)!.flag;
    setOriginal(md);
    setResult(null);
    setShowAll(false);
    setTab("output");
    setElapsed(0);
    setPhase("running");
    setLogs([
      { kind: "cmd", text: `$ newtion tidy ${flag} "${pageTitle || "제목 없음"}"${instruction.trim() ? ` --note "${instruction.trim()}"` : ""}` },
      { kind: "dim", text: `  reading document… ${md.split("\n").length} lines, ${md.length.toLocaleString()} chars` },
      { kind: "dim", text: "  sending to Claude…" },
    ]);

    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = Date.now();
    try {
      const res = await fetch("/api/tidy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({ pageId, markdown: md, mode, instruction }),
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res.ok) {
        log("err", `✖ error: ${data.error ?? `HTTP ${res.status}`}`);
        log("dim", `  failed after ${secs}s`);
        setPhase("error");
        return;
      }
      const r = data as Result;
      const d = diffLines(md, r.markdown);
      const add = d.filter((x) => x.type === "add").length;
      const del = d.filter((x) => x.type === "del").length;
      const e = r.notes.filter((n) => n.severity === "error").length;
      const w = r.notes.filter((n) => n.severity === "warning").length;
      const i = r.notes.filter((n) => n.severity === "info").length;
      log("dim", `  model ${r.model} · tokens in ${r.usage.input.toLocaleString()} / out ${r.usage.output.toLocaleString()}`);
      for (const n of r.notes) {
        log(n.severity === "error" ? "err" : "info", `  ${n.line > 0 ? `L${n.line}` : "--"}: ${n.severity} ${n.code}: ${n.message}`);
      }
      if (add + del === 0) log("ok", `✔ 변경 사항 없음 (${secs}s)`);
      else log(e ? "err" : "ok", `${e ? "⚠" : "✔"} 완료 ${secs}s — +${add} −${del} lines · ${e} error, ${w} warning, ${i} info`);
      log("dim", `  ${r.summary}`);
      setResult(r);
      setPhase("result");
      if (add + del > 0) setTab("diff");
    } catch (err) {
      if ((err as Error).name === "AbortError") log("err", "✖ 취소됨");
      else log("err", "✖ 네트워크 오류");
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  function apply() {
    if (!editor || !result) return;
    const current = editor.blocksToMarkdownLossy(editor.document).trimEnd();
    if (current !== original) {
      const ok = confirm("정리를 시작한 뒤 문서가 바뀌었습니다 (다른 사람이 편집했을 수 있음). 적용하면 그 변경이 덮어써집니다. 계속할까요?");
      if (!ok) return;
    }
    const blocks = editor.tryParseMarkdownToBlocks(result.markdown);
    editor.replaceBlocks(editor.document, blocks);
    log("ok", `✔ 적용됨 — ${blocks.length} blocks written. 되돌리려면 에디터에서 Ctrl/⌘+Z`);
    setPhase("applied");
    setTab("output");
  }

  function jumpTo(line: number) {
    if (line <= 0) return;
    setTab("diff");
    setShowAll(true);
    setHighlight(line);
    setTimeout(() => {
      bodyRef.current?.querySelector(`[data-new="${line}"]`)?.scrollIntoView({ block: "center" });
    }, 50);
  }

  const height = maximized ? "h-[85dvh]" : "h-[70dvh] md:h-[46vh]";

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[93] flex ${height} flex-col border-t border-zinc-700 bg-[#1e1e1e] font-mono text-[13px] text-zinc-200 shadow-2xl md:static md:z-auto md:shrink-0`}
    >
      {/* Title bar with tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-700 bg-[#252526] px-2 text-xs">
        <Terminal size={14} className="ml-1 text-zinc-400" />
        {([
          ["output", "출력"],
          ["diff", `변경 사항${result ? ` (+${stats.add} −${stats.del})` : ""}`],
          ["problems", "문제"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 border-b-2 px-2.5 py-2 uppercase tracking-wide ${
              tab === id ? "border-sky-400 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
            {id === "problems" && result && (
              <span className="flex items-center gap-1 normal-case">
                <CircleX size={12} className="text-red-400" />{counts.error}
                <AlertTriangle size={12} className="text-yellow-400" />{counts.warning}
                <Info size={12} className="text-sky-400" />{counts.info}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center">
          <button title={maximized ? "줄이기" : "키우기"} onClick={() => setMaximized((v) => !v)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-700">
            {maximized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button title="닫기" onClick={onClose} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-700">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 font-sans text-xs">
        {MODES.map((m) => (
          <button
            key={m.id}
            disabled={phase === "running"}
            onClick={() => setMode(m.id)}
            className={`rounded px-2.5 py-1 ${mode === m.id ? "bg-sky-600 text-white" : "bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700"} disabled:opacity-50`}
          >
            {m.label}
          </button>
        ))}
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={phase === "running"}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void run()}
          placeholder="추가 요청 (선택) 예: 표로 정리해줘"
          className="min-w-0 flex-1 basis-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-sky-500"
        />
        {phase === "running" ? (
          <button onClick={() => abortRef.current?.abort()} className="flex items-center gap-1 rounded bg-zinc-700 px-3 py-1 text-zinc-200 hover:bg-zinc-600">
            <X size={12} /> 중지 <span className="tabular-nums text-zinc-400">{elapsed.toFixed(1)}s</span>
          </button>
        ) : (
          <button onClick={run} disabled={!editor} className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 font-medium text-white hover:bg-green-500 disabled:opacity-50">
            {phase === "idle" ? <Play size={12} /> : <RotateCcw size={12} />} {phase === "idle" ? "실행" : "다시 실행"}
          </button>
        )}
      </div>

      {/* Body */}
      <div ref={bodyRef} className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        {tab === "output" && (
          <div className="space-y-0.5 p-3 leading-relaxed">
            {logs.length === 0 && (
              <div className="text-zinc-500">
                정리 방식을 고르고 ▶ 실행을 누르세요. Claude가 문서를 정리하고, 바뀐 부분을 이 창에 diff로 보여줍니다.
                <br />적용하기 전까지 문서는 바뀌지 않습니다.
              </div>
            )}
            {logs.map((l, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-words ${
                  l.kind === "cmd" ? "text-zinc-100" : l.kind === "ok" ? "text-green-400" : l.kind === "err" ? "text-red-400" : l.kind === "info" ? "text-zinc-300" : "text-zinc-500"
                }`}
              >
                {l.text}
              </div>
            ))}
            {phase === "running" && (
              <div className="flex items-center gap-2 text-sky-400">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Claude가 정리하는 중… <span className="tabular-nums">{elapsed.toFixed(1)}s</span>
              </div>
            )}
          </div>
        )}

        {tab === "diff" && (
          !result ? (
            <div className="p-3 text-zinc-500">아직 결과가 없습니다.</div>
          ) : stats.add + stats.del === 0 ? (
            <div className="p-3 text-green-400">✔ 바뀐 줄이 없습니다.</div>
          ) : (
            <div className="min-w-max md:min-w-0">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-[#1e1e1e] px-3 py-1 font-sans text-xs text-zinc-400">
                <span>
                  <span className="text-green-400">+{stats.add}</span> <span className="text-red-400">−{stats.del}</span> · 원본 → 정리본
                </span>
                <button onClick={() => setShowAll((v) => !v)} className="rounded px-2 py-0.5 hover:bg-zinc-700">
                  {showAll ? "변경 부분만" : "전체 보기"}
                </button>
              </div>
              {rows.map((r, idx) => {
                if (r.type === "skip") {
                  return (
                    <button key={`s${idx}`} onClick={() => setShowAll(true)} className="block w-full bg-[#252526] px-3 py-0.5 text-left text-xs text-zinc-500 hover:text-zinc-300">
                      ··· 변경 없는 {r.count}줄
                    </button>
                  );
                }
                const notes = r.type !== "del" ? notesByLine.get(r.newNo) : undefined;
                const worst = notes?.find((n) => n.severity === "error") ?? notes?.find((n) => n.severity === "warning") ?? notes?.[0];
                const newNo = r.type === "del" ? undefined : r.newNo;
                return (
                  <div
                    key={idx}
                    data-new={newNo}
                    className={`group flex ${
                      r.type === "add" ? "bg-green-500/10" : r.type === "del" ? "bg-red-500/10" : ""
                    } ${highlight != null && newNo === highlight ? "outline outline-1 -outline-offset-1 outline-sky-400" : ""}`}
                  >
                    <span className="w-10 shrink-0 select-none pr-1 text-right text-zinc-600">{r.type !== "add" ? r.oldNo : ""}</span>
                    <span className="w-10 shrink-0 select-none pr-1 text-right text-zinc-600">{r.type !== "del" ? r.newNo : ""}</span>
                    <span className={`w-5 shrink-0 select-none text-center ${r.type === "add" ? "text-green-400" : r.type === "del" ? "text-red-400" : "text-zinc-700"}`}>
                      {r.type === "add" ? "+" : r.type === "del" ? "−" : " "}
                    </span>
                    <span
                      className={`whitespace-pre-wrap break-all pr-3 ${
                        r.type === "add" ? "text-green-300" : r.type === "del" ? "text-red-300/90" : "text-zinc-400"
                      } ${worst ? "underline decoration-wavy underline-offset-4 " + (worst.severity === "error" ? "decoration-red-500" : worst.severity === "warning" ? "decoration-yellow-500" : "decoration-sky-500") : ""}`}
                      title={notes?.map((n) => `${n.severity} ${n.code}: ${n.message}`).join("\n")}
                    >
                      {r.text || " "}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}

        {tab === "problems" && (
          !result ? (
            <div className="p-3 text-zinc-500">아직 결과가 없습니다.</div>
          ) : result.notes.length === 0 ? (
            <div className="p-3 text-green-400">✔ 보고된 문제가 없습니다.</div>
          ) : (
            <div className="py-1">
              {(["error", "warning", "info"] as const).flatMap((sev) =>
                result.notes.filter((n) => n.severity === sev).map((n, i) => {
                  const S = SEV[sev];
                  return (
                    <button
                      key={`${sev}${i}`}
                      onClick={() => jumpTo(n.line)}
                      className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-zinc-800"
                    >
                      <S.icon size={14} className={`mt-0.5 shrink-0 ${S.cls}`} />
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans">
                        {n.message}
                        <span className="ml-2 font-mono text-xs text-zinc-500">{n.code}</span>
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">{n.line > 0 ? `Ln ${n.line}` : ""}</span>
                    </button>
                  );
                }),
              )}
            </div>
          )
        )}
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-800 bg-[#007acc] px-3 py-1.5 font-sans text-xs text-white" style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}>
        <span className="min-w-0 flex-1 truncate">
          {phase === "idle" && "준비됨"}
          {phase === "running" && `정리 중… ${elapsed.toFixed(0)}s`}
          {phase === "result" && result && `${result.summary}`}
          {phase === "applied" && "✔ 문서에 적용했습니다"}
          {phase === "error" && "✖ 실패 — 출력 탭을 확인하세요"}
        </span>
        {phase === "result" && result && stats.add + stats.del > 0 && (
          <>
            <button onClick={() => { setPhase("idle"); setResult(null); setTab("output"); log("dim", "  결과를 버렸습니다."); }} className="rounded bg-white/15 px-3 py-1 hover:bg-white/25">
              버리기
            </button>
            <button onClick={apply} className="flex items-center gap-1 rounded bg-white px-3 py-1 font-semibold text-[#007acc] hover:bg-zinc-100">
              <Check size={12} /> 적용
            </button>
          </>
        )}
      </div>
    </div>
  );
}
