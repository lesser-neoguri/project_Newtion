"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, RotateCcw, Sparkles, X } from "lucide-react";
import type { BlockNoteEditor } from "./editor";
import { diffLines, diffWords, type DiffLine } from "@/lib/line-diff";
import type { TidyMode, TidyResultT } from "@/app/api/tidy/route";

/* ------------------------------------------------------------------ */
/* State hook                                                          */
/* ------------------------------------------------------------------ */

type Phase = "idle" | "running" | "review" | "applied" | "error";
type Note = TidyResultT["notes"][number];
export interface TidyResult extends TidyResultT {
  model: string;
  usage: { input: number; output: number };
}

export function useTidy(editor: BlockNoteEditor | null, pageId: string, pageTitle: string) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<TidyMode>("tidy");
  const [instruction, setInstruction] = useState("");
  const [original, setOriginal] = useState("");
  const [result, setResult] = useState<TidyResult | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    if (!editor) return;
    const md = editor.blocksToMarkdownLossy(editor.document).trimEnd();
    setOriginal(md);
    setResult(null);
    setError("");
    setElapsed(0);
    setPhase("running");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/tidy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({ pageId, markdown: md, mode, instruction, title: pageTitle }),
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) {
        setError(data.error ?? "정리하지 못했습니다.");
        setPhase("error");
        return;
      }
      setResult(data as TidyResult);
      setPhase("review");
    } catch (e) {
      if ((e as Error).name === "AbortError") setPhase("idle");
      else {
        setError("네트워크 오류가 발생했습니다.");
        setPhase("error");
      }
    } finally {
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function discard() {
    setResult(null);
    setPhase("idle");
  }

  function apply() {
    if (!editor || !result) return;
    const current = editor.blocksToMarkdownLossy(editor.document).trimEnd();
    if (current !== original) {
      const ok = confirm("정리를 시작한 뒤 문서가 바뀌었습니다 (다른 사람이 편집했을 수 있어요). 적용하면 그 변경 내용이 덮어써집니다. 계속할까요?");
      if (!ok) return;
    }
    editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(result.markdown));
    setResult(null);
    setPhase("applied");
    setTimeout(() => {
      setPhase((p) => (p === "applied" ? "idle" : p));
      setOpen(false);
    }, 2500);
  }

  function close() {
    abortRef.current?.abort();
    setOpen(false);
    setResult(null);
    setPhase("idle");
  }

  return {
    open, setOpen, phase, mode, setMode, instruction, setInstruction, original, result, error, elapsed,
    run, cancel, discard, apply, close,
    reviewing: open && phase === "review" && !!result,
  };
}

export type TidyState = ReturnType<typeof useTidy>;

/* ------------------------------------------------------------------ */
/* Markdown line → Notion-like block rendering                         */
/* ------------------------------------------------------------------ */

type Kind =
  | { k: "h"; level: 1 | 2 | 3 }
  | { k: "bullet" }
  | { k: "num"; n: string }
  | { k: "todo"; checked: boolean }
  | { k: "quote" }
  | { k: "divider" }
  | { k: "fence" }
  | { k: "tableRow" }
  | { k: "tableSep" }
  | { k: "blank" }
  | { k: "p" };

const KIND_LABEL: Record<Kind["k"], string> = {
  h: "제목", bullet: "글머리 기호", num: "번호 목록", todo: "할 일", quote: "인용",
  divider: "구분선", fence: "코드", tableRow: "표", tableSep: "표", blank: "빈 줄", p: "문단",
};

function parseLine(raw: string): { kind: Kind; text: string; indent: number } {
  const indent = Math.floor((raw.match(/^\s*/)?.[0].length ?? 0) / 2);
  const t = raw.trim();
  let m: RegExpMatchArray | null;
  if (!t) return { kind: { k: "blank" }, text: "", indent };
  if ((m = t.match(/^(#{1,3})\s+(.*)$/))) return { kind: { k: "h", level: m[1].length as 1 | 2 | 3 }, text: m[2], indent };
  if ((m = t.match(/^[-*]\s+\[( |x|X)\]\s*(.*)$/))) return { kind: { k: "todo", checked: m[1] !== " " }, text: m[2], indent };
  if ((m = t.match(/^[-*+]\s+(.*)$/))) return { kind: { k: "bullet" }, text: m[1], indent };
  if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) return { kind: { k: "num", n: m[1] }, text: m[2], indent };
  if ((m = t.match(/^>\s?(.*)$/))) return { kind: { k: "quote" }, text: m[1], indent };
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return { kind: { k: "divider" }, text: "", indent };
  if (/^```/.test(t)) return { kind: { k: "fence" }, text: t.slice(3), indent };
  if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(t)) return { kind: { k: "tableSep" }, text: "", indent };
  if (t.startsWith("|")) return { kind: { k: "tableRow" }, text: t, indent };
  return { kind: { k: "p" }, text: t.replace(/\*\*(.+?)\*\*/g, "$1"), indent };
}

const sameKind = (a: Kind, b: Kind) => JSON.stringify({ ...a, checked: undefined, n: undefined }) === JSON.stringify({ ...b, checked: undefined, n: undefined });

/** Text with inline word-level changes. */
function Segments({ segs }: { segs: ReturnType<typeof diffWords> }) {
  return (
    <>
      {segs.map((s, i) =>
        s.type === "same" ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : s.type === "del" ? (
          <del key={i} className="rounded-sm bg-red-100 text-red-700 decoration-red-500/70 dark:bg-red-950/60 dark:text-red-300">{s.text}</del>
        ) : (
          <ins key={i} className="rounded-sm bg-green-100 text-green-800 no-underline dark:bg-green-900/50 dark:text-green-200">{s.text}</ins>
        ),
      )}
    </>
  );
}

function TableCells({ text, segs }: { text: string; segs?: ReturnType<typeof diffWords> }) {
  if (segs) {
    return <div className="rounded border border-line px-2 py-1 font-mono text-[13px]"><Segments segs={segs} /></div>;
  }
  const cells = text.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return (
    <div className="flex border-x border-t border-line text-sm last:border-b">
      {cells.map((c, i) => (
        <div key={i} className="min-w-0 flex-1 border-r border-line px-2 py-1 last:border-r-0">{c || " "}</div>
      ))}
    </div>
  );
}

function BlockView({
  kind, indent, children, inCode,
}: { kind: Kind; indent: number; children: React.ReactNode; inCode: boolean }) {
  const pad = { paddingLeft: indent * 24 };
  if (inCode) return <div className="bg-hover px-3 font-mono text-[13px] leading-6" style={pad}>{children}</div>;
  switch (kind.k) {
    case "h": {
      const cls = kind.level === 1 ? "mt-6 text-[1.75rem] font-bold" : kind.level === 2 ? "mt-5 text-2xl font-semibold" : "mt-4 text-xl font-semibold";
      return <div className={`${cls} leading-snug`} style={pad}>{children}</div>;
    }
    case "bullet":
      return <div className="flex gap-2 py-0.5" style={pad}><span className="select-none">•</span><div className="min-w-0 flex-1">{children}</div></div>;
    case "num":
      return <div className="flex gap-2 py-0.5" style={pad}><span className="select-none tabular-nums">{kind.n}.</span><div className="min-w-0 flex-1">{children}</div></div>;
    case "todo":
      return (
        <div className="flex items-start gap-2 py-0.5" style={pad}>
          <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${kind.checked ? "border-accent bg-accent text-white" : "border-foreground/40"}`}>
            {kind.checked && <Check size={12} />}
          </span>
          <div className={`min-w-0 flex-1 ${kind.checked ? "text-muted line-through" : ""}`}>{children}</div>
        </div>
      );
    case "quote":
      return <div className="my-0.5 border-l-[3px] border-foreground pl-3" style={pad}>{children}</div>;
    case "divider":
      return <hr className="my-3 border-line" />;
    case "blank":
      return <div className="h-2" />;
    default:
      return <div className="py-0.5" style={pad}>{children}</div>;
  }
}

/** Removes Markdown spelling differences that don't change the document
 *  (BlockNote exports "* item" and escapes brackets; Claude writes "- item"). */
function normalizeMd(md: string) {
  return md
    .split("\n")
    .map((l) =>
      l
        .replace(/\s+$/, "")
        .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
        .replace(/^(\s*)[*+](\s+)/, "$1-$2")
        .replace(/^(\s*)- \[X\]/, "$1- [x]"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Review view (replaces the editor while reviewing)                   */
/* ------------------------------------------------------------------ */

type Row =
  | { t: "same"; line: DiffLine & { type: "same" } }
  | { t: "add"; line: DiffLine & { type: "add" } }
  | { t: "del"; line: DiffLine & { type: "del" } }
  | { t: "change"; del: DiffLine & { type: "del" }; add: DiffLine & { type: "add" } }
  | { t: "skip"; count: number; lines: (DiffLine & { type: "same" })[] };

/** Pair adjacent deleted/added lines into "changed" rows so edits show inline. */
function buildRows(lines: DiffLine[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "same") { rows.push({ t: "same", line: l }); i++; continue; }
    const dels: (DiffLine & { type: "del" })[] = [];
    const adds: (DiffLine & { type: "add" })[] = [];
    // Collect the whole run of edits; blank "unchanged" lines are just separators,
    // so step over them instead of letting them split the run.
    while (i < lines.length) {
      const x = lines[i];
      if (x.type === "same") {
        if (x.text.trim() !== "") break;
        let k = i;
        while (k < lines.length && lines[k].type === "same" && lines[k].text.trim() === "") k++;
        if (k >= lines.length || lines[k].type === "same") break;
        i = k;
        continue;
      }
      if (x.type === "del") dels.push(x);
      else adds.push(x);
      i++;
    }
    // Pair lines that look like edits of each other (share enough words).
    const usedAdd = new Set<number>();
    const paired = new Map<number, number>();
    dels.forEach((d, di) => {
      let best = -1, bestScore = 0.34;
      adds.forEach((a, ai) => {
        if (usedAdd.has(ai)) return;
        const s = similarity(parseLine(d.text).text, parseLine(a.text).text);
        if (s > bestScore) { bestScore = s; best = ai; }
      });
      if (best >= 0) { usedAdd.add(best); paired.set(di, best); }
    });
    // Removed lines first, then the new lines (edited ones shown inline).
    dels.forEach((d, k) => { if (!paired.has(k)) rows.push({ t: "del", line: d }); });
    const delByAdd = new Map([...paired].map(([d, a]) => [a, d]));
    adds.forEach((a, ai) => {
      const d = delByAdd.get(ai);
      rows.push(d !== undefined ? { t: "change", del: dels[d], add: a } : { t: "add", line: a });
    });
  }
  return rows;
}

function similarity(a: string, b: string) {
  const A = new Set(a.split(/\s+/).filter(Boolean));
  const B = new Set(b.split(/\s+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((w) => { if (B.has(w)) common++; });
  // Korean edits often change a word's ending, so also compare characters.
  const ca = new Set(a.replace(/\s/g, "")), cb = new Set(b.replace(/\s/g, ""));
  let cc = 0;
  ca.forEach((c) => { if (cb.has(c)) cc++; });
  return Math.max(common / Math.max(A.size, B.size), cc / Math.max(ca.size, cb.size) - 0.15);
}

function collapse(rows: Row[], context = 1): Row[] {
  const changed = rows.map((r) => r.t !== "same");
  const keep = rows.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) if (changed[k]) return true;
    return false;
  });
  const out: Row[] = [];
  let buf: (DiffLine & { type: "same" })[] = [];
  rows.forEach((r, i) => {
    if (keep[i] || r.t !== "same") {
      if (buf.length) out.push({ t: "skip", count: buf.length, lines: buf });
      buf = [];
      out.push(r);
    } else buf.push(r.line);
  });
  if (buf.length) out.push({ t: "skip", count: buf.length, lines: buf });
  return out;
}

const NOTE_STYLE = {
  error: { emoji: "🔴", label: "확인 필요", cls: "border-red-400 bg-red-50 dark:bg-red-950/40" },
  warning: { emoji: "🟡", label: "주의", cls: "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30" },
  info: { emoji: "🔵", label: "수정", cls: "border-sky-400 bg-sky-50 dark:bg-sky-950/30" },
} as const;

function NoteCard({ n }: { n: Note }) {
  const s = NOTE_STYLE[n.severity];
  return (
    <div className={`rounded-md border-l-[3px] px-2.5 py-1.5 text-xs leading-relaxed ${s.cls}`}>
      <span className="mr-1">{s.emoji}</span>
      <b className="font-semibold">{s.label}</b>
      <span className="mx-1 text-muted">·</span>
      {n.message}
    </div>
  );
}

export function TidyReview({ tidy }: { tidy: TidyState }) {
  const { original, result } = tidy;
  const [onlyChanges, setOnlyChanges] = useState(false);

  const lines = useMemo(
    () => (result ? diffLines(normalizeMd(original), normalizeMd(result.markdown)) : []),
    [original, result],
  );
  // Blank Markdown lines are only separators; leave them out of the review.
  const rows = useMemo(
    () => buildRows(lines).filter((r) => r.t === "change" || r.t === "skip" || r.line.text.trim() !== ""),
    [lines],
  );
  const shown = useMemo(() => (onlyChanges ? collapse(rows) : rows), [rows, onlyChanges]);
  // Which rows sit inside a ``` code block (in new-document order).
  const codeFlags = useMemo(() => {
    const flags: boolean[] = [];
    let inCode = false;
    for (const r of shown) {
      const text = r.t === "skip" ? "" : r.t === "change" ? r.add.text : r.line.text;
      const isFence = r.t !== "skip" && parseLine(text).kind.k === "fence";
      if (isFence) inCode = !inCode;
      flags.push(!isFence && r.t !== "skip" && inCode);
    }
    return flags;
  }, [shown]);
  const visibleNewNos = useMemo(
    () => rows.flatMap((r) => (r.t === "change" ? [r.add.newNo] : r.t === "same" || r.t === "add" ? [r.line.newNo] : [])).sort((a, b) => a - b),
    [rows],
  );
  // Attach each note to the visible line it points at (or the next one, if it points at a blank line).
  const notesByLine = useMemo(() => {
    const m = new Map<number, Note[]>();
    for (const n of result?.notes ?? []) {
      if (n.line <= 0) continue;
      const target = visibleNewNos.find((no) => no >= n.line) ?? visibleNewNos[visibleNewNos.length - 1];
      if (target != null) m.set(target, [...(m.get(target) ?? []), n]);
    }
    return m;
  }, [result, visibleNewNos]);
  if (!result) return null;

  const counts = {
    changed: rows.filter((r) => r.t === "change").length,
    added: rows.filter((r) => r.t === "add" && parseLine(r.line.text).kind.k !== "blank").length,
    removed: rows.filter((r) => r.t === "del" && parseLine(r.line.text).kind.k !== "blank").length,
    error: result.notes.filter((n) => n.severity === "error").length,
  };
  const generalNotes = result.notes.filter((n) => n.line <= 0 || !visibleNewNos.length);
  const nothing = counts.changed + counts.added + counts.removed === 0;

  return (
    <div className="pb-40">
      {/* Summary callout */}
      <div className="mb-5 flex gap-3 rounded-lg bg-hover px-4 py-3">
        <span className="text-xl leading-none">✨</span>
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="leading-relaxed">{nothing ? "고칠 부분이 없었어요. 문서가 이미 잘 정리되어 있어요." : result.summary}</p>
          {!nothing && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {counts.changed > 0 && <span className="rounded bg-background px-2 py-0.5">✏️ 수정 {counts.changed}</span>}
              {counts.added > 0 && <span className="rounded bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900/50 dark:text-green-200">＋ 추가 {counts.added}</span>}
              {counts.removed > 0 && <span className="rounded bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-950/60 dark:text-red-300">－ 삭제 {counts.removed}</span>}
              {counts.error > 0 && <span className="rounded bg-red-500 px-2 py-0.5 text-white">🔴 확인 필요 {counts.error}</span>}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-muted">
                <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
                바뀐 부분만 보기
              </label>
            </div>
          )}
          {generalNotes.length > 0 && <div className="space-y-1">{generalNotes.map((n, i) => <NoteCard key={i} n={n} />)}</div>}
        </div>
      </div>

      {/* Document with inline changes */}
      <div className="text-base leading-7">
        {shown.map((r, idx) => {
          if (r.t === "skip") {
            return (
              <button key={idx} onClick={() => setOnlyChanges(false)} className="my-1 block w-full rounded py-0.5 text-left text-xs text-muted hover:bg-hover">
                ⋯ 바뀌지 않은 {r.count}줄
              </button>
            );
          }
          const base = r.t === "change" ? r.add : r.line;
          const p = parseLine(base.text);
          if (p.kind.k === "tableSep") return null;
          if (p.kind.k === "fence" && r.t === "same") return null;
          const inCode = codeFlags[idx];

          let body: React.ReactNode;
          let tag: string | null = null;
          if (r.t === "change") {
            const pd = parseLine(r.del.text);
            if (!sameKind(pd.kind, p.kind) && pd.kind.k !== "blank") tag = `${KIND_LABEL[pd.kind.k]} → ${KIND_LABEL[p.kind.k]}`;
            const segs = diffWords(pd.text, p.text);
            body = p.kind.k === "tableRow" ? <TableCells text={p.text} segs={segs} /> : <Segments segs={segs} />;
          } else if (p.kind.k === "tableRow") {
            body = <TableCells text={p.text} />;
          } else {
            body = p.text || (p.kind.k === "blank" ? null : " ");
          }

          const newNo = r.t === "del" ? undefined : r.t === "change" ? r.add.newNo : r.line.newNo;
          const notes = newNo ? notesByLine.get(newNo) : undefined;
          const wrap =
            r.t === "add" ? "border-l-[3px] border-green-500 bg-green-50/70 pl-2 dark:bg-green-950/30"
            : r.t === "del" ? "border-l-[3px] border-red-400 bg-red-50/60 pl-2 text-red-700/80 line-through decoration-red-400/70 opacity-80 dark:bg-red-950/20 dark:text-red-300/80"
            : r.t === "change" ? "border-l-[3px] border-amber-400 pl-2"
            : "border-l-[3px] border-transparent pl-2";

          return (
            <div key={idx} className="grid gap-x-4 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className={`relative -ml-[11px] rounded-r ${wrap}`}>
                {tag && <span className="float-right ml-2 mt-1 rounded bg-amber-100 px-1.5 py-px text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tag}</span>}
                <BlockView kind={p.kind} indent={p.indent} inCode={inCode && p.kind.k !== "fence"}>{body}</BlockView>
              </div>
              <div className="space-y-1 pb-1 lg:pt-1">
                {notes?.map((n, i) => <NoteCard key={i} n={n} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notion-AI-style floating bar                                        */
/* ------------------------------------------------------------------ */

const MODES: { id: TidyMode; label: string; desc: string }[] = [
  { id: "tidy", label: "✨ 전체 정리", desc: "맞춤법·중복·구조를 한 번에" },
  { id: "proofread", label: "✍️ 맞춤법·문장", desc: "구조는 그대로, 문장만" },
  { id: "structure", label: "🧱 구조 개선", desc: "제목·목록·표로 정리" },
];

export function TidyBar({ tidy }: { tidy: TidyState }) {
  const { phase } = tidy;
  if (!tidy.open) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[93] flex justify-center px-0 sm:bottom-5 sm:px-4 md:left-64">
      <div
        className="pointer-events-auto w-full max-w-2xl border-t border-line bg-background shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:rounded-xl sm:border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {(phase === "idle" || phase === "error") && (
          <div className="p-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => tidy.setMode(m.id)}
                  title={m.desc}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                    tidy.mode === m.id ? "border-accent bg-accent/10 font-medium text-accent" : "border-line text-foreground/80 hover:bg-hover"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void tidy.run(); }} className="flex items-center gap-2">
              <Sparkles size={18} className="shrink-0 text-purple-500" />
              <input
                autoFocus
                value={tidy.instruction}
                onChange={(e) => tidy.setInstruction(e.target.value)}
                placeholder="AI에게 원하는 정리 방법을 알려주세요 (선택)"
                className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted"
              />
              <button className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
                정리하기 <ArrowRight size={14} />
              </button>
              <button type="button" title="닫기" onClick={tidy.close} className="shrink-0 rounded p-1.5 text-muted hover:bg-hover">
                <X size={16} />
              </button>
            </form>
            {phase === "error" && <p className="mt-2 text-sm text-red-500">⚠️ {tidy.error}</p>}
          </div>
        )}

        {phase === "running" && (
          <div className="flex items-center gap-3 p-3 text-sm">
            <Sparkles size={18} className="shrink-0 animate-pulse text-purple-500" />
            <span className="flex-1">
              AI가 문서를 정리하고 있어요
              <span className="ml-1 inline-flex gap-0.5 align-middle">
                {[0, 150, 300].map((d) => <span key={d} className="h-1 w-1 animate-bounce rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />)}
              </span>
              <span className="ml-2 tabular-nums text-muted">{tidy.elapsed}초</span>
            </span>
            <button onClick={tidy.cancel} className="rounded-md border border-line px-3 py-1 hover:bg-hover">중지</button>
          </div>
        )}

        {phase === "review" && (
          <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <Sparkles size={18} className="hidden shrink-0 text-purple-500 sm:block" />
            <span className="hidden min-w-0 flex-1 sm:inline">바뀐 부분을 확인하고 적용하세요</span>
            <button onClick={tidy.discard} className="mr-auto rounded-md px-3 py-1.5 text-muted hover:bg-hover sm:mr-0">버리기</button>
            <button onClick={() => void tidy.run()} className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 hover:bg-hover">
              <RotateCcw size={13} /> 다시 시도
            </button>
            <button onClick={tidy.apply} className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 font-medium text-white">
              <Check size={14} /> 적용하기
            </button>
          </div>
        )}

        {phase === "applied" && (
          <div className="flex items-center gap-2 p-3 text-sm">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white"><Check size={12} /></span>
            적용했어요. 되돌리려면 문서에서 Ctrl/⌘ + Z
          </div>
        )}
      </div>
    </div>
  );
}
