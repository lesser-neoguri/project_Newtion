"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { parseData } from "@/lib/blocks/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEditor = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBlock = any;

export const uid = () => Math.random().toString(36).slice(2, 9);

/** Lists written by AI tools (or by hand in Markdown) may lack ids: give them stable ones. */
function withIds<T extends object>(d: T): T {
  const out = { ...d } as Record<string, unknown>;
  for (const k of ["cards", "events", "recipes", "series", "rows", "items"]) {
    const list = out[k];
    if (Array.isArray(list) && list.some((x) => x && typeof x === "object" && !("id" in x))) {
      out[k] = list.map((x, i) => (x && typeof x === "object" && !("id" in x) ? { ...x, id: `i${i}` } : x));
    }
  }
  return out as T;
}

/** Block data stored as JSON in props.data. Returns [data, set, editable]. */
export function useBlockData<T extends object>(block: AnyBlock, editor: AnyEditor, defaults: T) {
  const raw: string = block.props.data ?? "";
  const data = useStableParse(raw, defaults);
  const set = useCallback((next: T | ((d: T) => T)) => {
    const cur = withIds(parseData(editor.getBlock(block.id)?.props.data, defaults));
    const value = typeof next === "function" ? (next as (d: T) => T)(cur) : next;
    editor.updateBlock(block.id, { props: { data: JSON.stringify(value) } });
  }, [editor, block.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, set, editor.isEditable as boolean] as const;
}

function useStableParse<T extends object>(raw: string, defaults: T): T {
  const ref = useRef<{ raw: string; value: T } | null>(null);
  if (!ref.current || ref.current.raw !== raw) ref.current = { raw, value: withIds(parseData(raw, defaults)) };
  return ref.current.value;
}

/** Text input that writes back on blur / Enter (not on every keystroke). */
export function Field({
  value, onCommit, placeholder, className = "", multiline, type = "text", readOnly,
}: {
  value: string | number;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  type?: string;
  readOnly?: boolean;
}) {
  const [v, setV] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(String(value ?? "")); }, [value]);
  const commit = () => { focused.current = false; if (v !== String(value ?? "")) onCommit(v); };
  const common = {
    value: v,
    placeholder,
    readOnly,
    onFocus: () => { focused.current = true; },
    onBlur: commit,
    className: `nb-field ${className}`,
  };
  if (multiline) {
    return (
      <textarea {...common} rows={2} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLElement).blur(); }} />
    );
  }
  return (
    <input {...common} type={type} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLElement).blur(); }} />
  );
}

export function Shell({ icon, title, actions, children, className = "", bare }: {
  icon: string; title: string; actions?: ReactNode; children: ReactNode; className?: string;
  /** No frame: the block reads like part of the page; its controls show on hover (desktop). */
  bare?: boolean;
}) {
  // Taps/clicks inside a block belong to the block. Without this the editor (which listens on its root,
  // before React's handlers run) treats them as "select this whole block" — the blue box on phones.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    // Only the events ProseMirror uses to pick a node selection. Clicks and pointer events still reach React.
    const events = ["mousedown", "touchstart"];
    events.forEach((ev) => el.addEventListener(ev, stop));
    return () => events.forEach((ev) => el.removeEventListener(ev, stop));
  }, []);
  return (
    <div ref={ref} className={`nb-block ${bare ? "nb-bare" : ""} ${className}`} contentEditable={false}>
      <div className="nb-head">
        <span className="nb-title"><span>{icon}</span>{title}</span>
        <span className="nb-actions">{actions}</span>
      </div>
      {children}
    </div>
  );
}

export function Btn({ children, onClick, title, active, disabled }: { children: ReactNode; onClick: () => void; title?: string; active?: boolean; disabled?: boolean }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`nb-btn ${active ? "nb-btn-on" : ""}`}>
      {children}
    </button>
  );
}

export const SWATCHES = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

export function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
