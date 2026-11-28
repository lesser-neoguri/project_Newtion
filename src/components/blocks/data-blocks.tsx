"use client";

import { useMemo, useState } from "react";
import { Dices, Plus, Table2, Trash2 } from "lucide-react";
import { Btn, Field, SWATCHES, Shell, uid, useBlockData, type AnyBlock, type AnyEditor } from "./common";

/* ------------------------------------------------------------------ */
/* Safe formula parser: numbers, x, + - * / % ^, (), functions         */
/* ------------------------------------------------------------------ */

const FNS: Record<string, (...a: number[]) => number> = {
  floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp,
  log: Math.log, log2: Math.log2, log10: Math.log10, sin: Math.sin, cos: Math.cos, min: Math.min, max: Math.max,
  pow: Math.pow, clamp: (v, a, b) => Math.min(Math.max(v, a), b),
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Node = (x: number) => number;

export function compile(src: string): Node {
  const s = src.replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  const eat = (c: string) => { if (s[i] === c) { i++; return true; } return false; };
  const fail = (m: string): never => { throw new Error(`${m} (${i + 1}번째 글자)`); };

  function expr(): Node {
    let l = term();
    for (;;) {
      if (eat("+")) { const a = l, b = term(); l = (x) => a(x) + b(x); }
      else if (eat("-")) { const a = l, b = term(); l = (x) => a(x) - b(x); }
      else return l;
    }
  }
  function term(): Node {
    let l = unary();
    for (;;) {
      if (eat("*")) { const a = l, b = unary(); l = (x) => a(x) * b(x); }
      else if (eat("/")) { const a = l, b = unary(); l = (x) => a(x) / b(x); }
      else if (eat("%")) { const a = l, b = unary(); l = (x) => a(x) % b(x); }
      else return l;
    }
  }
  function unary(): Node {
    if (eat("-")) { const a = unary(); return (x) => -a(x); }
    if (eat("+")) return unary();
    return power();
  }
  function power(): Node {
    const base = atom();
    if (eat("^")) { const e = unary(); return (x) => Math.pow(base(x), e(x)); }
    return base;
  }
  function atom(): Node {
    if (eat("(")) { const e = expr(); if (!eat(")")) fail("')'가 필요해요"); return e; }
    const num = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { i += num[0].length; const v = parseFloat(num[0]); return () => v; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0].toLowerCase();
      if (name === "x" || name === "n" || name === "lv" || name === "level") return (x) => x;
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      if (name in FNS) {
        if (!eat("(")) fail(`${name} 다음에 '('가 필요해요`);
        const args: Node[] = [];
        if (!eat(")")) { do args.push(expr()); while (eat(",")); if (!eat(")")) fail("')'가 필요해요"); }
        const f = FNS[name];
        return (x) => f(...args.map((a) => a(x)));
      }
      fail(`'${id[0]}'를 모르겠어요`);
    }
    return fail(peek() ? `'${peek()}' 자리에 숫자나 x가 필요해요` : "식이 끝났어요");
  }
  const out = expr();
  if (i < s.length) fail(`'${s[i]}'를 해석할 수 없어요`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Balance curve                                                       */
/* ------------------------------------------------------------------ */

interface Series { id: string; name: string; expr: string; color: string }
interface CurveData { from: number; to: number; step: number; xLabel: string; series: Series[] }
export const CURVE_DEFAULT: CurveData = {
  from: 1, to: 50, step: 1, xLabel: "레벨",
  series: [
    { id: "a", name: "필요 경험치", expr: "floor(100 * 1.12^(x-1))", color: "#3b82f6" },
    { id: "b", name: "몬스터 체력", expr: "40 + 18*x + 0.9*x^2", color: "#ef4444" },
  ],
};

const fmt = (v: number) => (!isFinite(v) ? "—" : Math.abs(v) >= 1e6 ? v.toExponential(2) : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : +v.toFixed(2) + "");

export function CurveView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, CURVE_DEFAULT);
  const [edit, setEdit] = useState(false);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const editing = editable && edit;

  const xs = useMemo(() => {
    const out: number[] = [];
    const step = d.step > 0 ? d.step : 1;
    for (let x = d.from; x <= d.to && out.length < 1000; x += step) out.push(+x.toFixed(6));
    return out;
  }, [d.from, d.to, d.step]);
  const computed = useMemo(() => d.series.map((s) => {
    try { const f = compile(s.expr); return { ...s, ys: xs.map((x) => f(x)), error: null as string | null }; }
    catch (e) { return { ...s, ys: [] as number[], error: (e as Error).message }; }
  }), [d.series, xs]);

  const all = computed.flatMap((c) => c.ys.filter(isFinite));
  const yMin = Math.min(0, ...all), yMax = Math.max(1, ...all);
  const W = 640, H = 240, L = 48, B = 22, T = 10, R = 10;
  const sx = (i: number) => L + (xs.length > 1 ? (i / (xs.length - 1)) * (W - L - R) : 0);
  const sy = (v: number) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const ticks = 4;

  return (
    <Shell icon="📈" title="밸런스 곡선" actions={
      <>
        <Btn active={table} onClick={() => setTable((v) => !v)}><Table2 size={13} /> 표</Btn>
        {editable && <Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "편집"}</Btn>}
      </>
    }>
      {editing && (
        <div className="mb-2 space-y-1.5">
          {d.series.map((s) => (
            <div key={s.id} className="nb-row">
              <input type="color" value={s.color} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                onChange={(e) => set({ ...d, series: d.series.map((q) => (q.id === s.id ? { ...q, color: e.target.value } : q)) })} />
              <Field value={s.name} placeholder="이름" className="w-28" onCommit={(v) => set({ ...d, series: d.series.map((q) => (q.id === s.id ? { ...q, name: v } : q)) })} />
              <span className="text-muted">=</span>
              <Field value={s.expr} placeholder="예: 10 * 1.15^x" className="min-w-0 flex-1 font-mono" onCommit={(v) => set({ ...d, series: d.series.map((q) => (q.id === s.id ? { ...q, expr: v } : q)) })} />
              <Btn title="삭제" onClick={() => set({ ...d, series: d.series.filter((q) => q.id !== s.id) })}><Trash2 size={12} /></Btn>
            </div>
          ))}
          <div className="nb-row">
            <Btn onClick={() => set({ ...d, series: [...d.series, { id: uid(), name: "", expr: "x", color: SWATCHES[(d.series.length * 3) % SWATCHES.length] }] })}><Plus size={12} /> 곡선 추가</Btn>
            <span className="nb-label">x</span>
            <Field value={d.from} type="number" className="w-16" onCommit={(v) => set({ ...d, from: +v || 0 })} /> ~
            <Field value={d.to} type="number" className="w-16" onCommit={(v) => set({ ...d, to: +v || 1 })} />
            <span className="nb-label">간격</span><Field value={d.step} type="number" className="w-14" onCommit={(v) => set({ ...d, step: +v || 1 })} />
            <span className="nb-label">x 이름</span><Field value={d.xLabel} className="w-20" onCommit={(v) => set({ ...d, xLabel: v })} />
          </div>
          <p className="text-xs text-muted">x(=n, lv), + − × ÷ ^ %, floor·ceil·round·min·max·clamp·sqrt·log·exp·pow</p>
        </div>
      )}
      {computed.some((c) => c.error) && (
        <div className="nb-error">{computed.filter((c) => c.error).map((c) => <div key={c.id}>⚠️ {c.name || c.expr}: {c.error}</div>)}</div>
      )}
      <div className="flex flex-wrap gap-3 px-1 pb-1 text-xs">
        {computed.map((c) => <span key={c.id} className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: c.color }} />{c.name || c.expr}</span>)}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - L) / (W - L - R)) * (xs.length - 1));
            setHover(i >= 0 && i < xs.length ? i : null);
          }}>
          {Array.from({ length: ticks + 1 }, (_, k) => {
            const v = yMin + ((yMax - yMin) * k) / ticks;
            return (
              <g key={k}>
                <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="currentColor" opacity={0.08} />
                <text x={L - 6} y={sy(v) + 3} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.5}>{fmt(v)}</text>
              </g>
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const i = Math.round(f * (xs.length - 1));
            return xs[i] !== undefined && <text key={f} x={sx(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.5}>{xs[i]}</text>;
          })}
          <text x={W - R} y={H - B - 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.5}>{d.xLabel} →</text>
          {computed.map((c) => (
            <polyline key={c.id} fill="none" stroke={c.color} strokeWidth={2} strokeLinejoin="round"
              points={c.ys.map((v, i) => (isFinite(v) ? `${sx(i)},${sy(v)}` : "")).join(" ")} />
          ))}
          {hover !== null && (
            <g>
              <line x1={sx(hover)} x2={sx(hover)} y1={T} y2={H - B} stroke="currentColor" opacity={0.25} />
              {computed.map((c) => isFinite(c.ys[hover]) && <circle key={c.id} cx={sx(hover)} cy={sy(c.ys[hover])} r={3.5} fill={c.color} />)}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="nb-tip" style={{ left: `${(sx(hover) / W) * 100}%` }}>
            <b>{d.xLabel} {xs[hover]}</b>
            {computed.map((c) => <div key={c.id} className="flex justify-between gap-3"><span style={{ color: c.color }}>{c.name || c.expr}</span><span className="tabular-nums">{fmt(c.ys[hover])}</span></div>)}
          </div>
        )}
      </div>
      {table && (
        <div className="nb-table-wrap">
          <table className="nb-table">
            <thead><tr><th>{d.xLabel}</th>{computed.map((c) => <th key={c.id}>{c.name || c.expr}</th>)}</tr></thead>
            <tbody>{xs.map((x, i) => <tr key={i}><td>{x}</td>{computed.map((c) => <td key={c.id}>{fmt(c.ys[i])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Drop table                                                          */
/* ------------------------------------------------------------------ */

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: "일반", color: "#9ca3af" }, uncommon: { label: "고급", color: "#22c55e" }, rare: { label: "희귀", color: "#3b82f6" },
  epic: { label: "영웅", color: "#a855f7" }, legendary: { label: "전설", color: "#f59e0b" },
};
interface DropRow { id: string; name: string; weight: number; min: number; max: number; rarity: Rarity }
interface DropData { rolls: number; rows: DropRow[] }
export const DROP_DEFAULT: DropData = {
  rolls: 1,
  rows: [
    { id: "a", name: "없음", weight: 40, min: 0, max: 0, rarity: "common" },
    { id: "b", name: "철광석", weight: 35, min: 1, max: 3, rarity: "common" },
    { id: "c", name: "금광석", weight: 15, min: 1, max: 2, rarity: "uncommon" },
    { id: "d", name: "성채 엔진 부품", weight: 8, min: 1, max: 1, rarity: "rare" },
    { id: "e", name: "고대 코어", weight: 2, min: 1, max: 1, rarity: "legendary" },
  ],
};

export function DropTableView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, DROP_DEFAULT);
  const [edit, setEdit] = useState(false);
  const [sim, setSim] = useState<{ n: number; counts: Record<string, number>; qty: Record<string, number> } | null>(null);
  const editing = editable && edit;
  const total = d.rows.reduce((n, r) => n + Math.max(0, r.weight), 0) || 1;
  const upd = (id: string, f: Partial<DropRow>) => set({ ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...f } : r)) });

  const simulate = (n: number) => {
    const counts: Record<string, number> = {}, qty: Record<string, number> = {};
    for (let k = 0; k < n * Math.max(1, d.rolls); k++) {
      let r = Math.random() * total;
      const row = d.rows.find((x) => (r -= Math.max(0, x.weight)) < 0) ?? d.rows[d.rows.length - 1];
      counts[row.id] = (counts[row.id] ?? 0) + 1;
      qty[row.id] = (qty[row.id] ?? 0) + row.min + Math.floor(Math.random() * (Math.max(row.min, row.max) - row.min + 1));
    }
    setSim({ n, counts, qty });
  };

  return (
    <Shell icon="🎲" title="드롭 테이블" actions={
      <>
        <Btn onClick={() => simulate(1000)}><Dices size={13} /> 1000번 굴리기</Btn>
        {editable && <Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "편집"}</Btn>}
      </>
    }>
      <div className="nb-table-wrap">
        <table className="nb-table">
          <thead>
            <tr><th className="text-left">아이템</th><th>가중치</th><th>확률</th><th>수량</th><th>기대 개수</th>{sim && <th>시뮬레이션</th>}{editing && <th />}</tr>
          </thead>
          <tbody>
            {d.rows.map((r) => {
              const p = Math.max(0, r.weight) / total;
              const exp = p * ((r.min + Math.max(r.min, r.max)) / 2) * Math.max(1, d.rolls);
              return (
                <tr key={r.id}>
                  <td className="text-left">
                    {editing ? (
                      <div className="flex items-center gap-1">
                        <select className="nb-field w-auto" value={r.rarity} onChange={(e) => upd(r.id, { rarity: e.target.value as Rarity })}>
                          {Object.entries(RARITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <Field value={r.name} className="min-w-0 flex-1" onCommit={(v) => upd(r.id, { name: v })} />
                      </div>
                    ) : (
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: RARITY[r.rarity]?.color }} /><b style={{ color: RARITY[r.rarity]?.color }}>{r.name}</b></span>
                    )}
                  </td>
                  <td>{editing ? <Field value={r.weight} type="number" className="w-16" onCommit={(v) => upd(r.id, { weight: Math.max(0, +v || 0) })} /> : r.weight}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="nb-bar"><span style={{ width: `${p * 100}%`, background: RARITY[r.rarity]?.color }} /></span>
                      <span className="w-12 tabular-nums">{(p * 100).toFixed(p < 0.01 ? 2 : 1)}%</span>
                    </div>
                  </td>
                  <td>{editing ? (
                    <span className="flex items-center gap-0.5"><Field value={r.min} type="number" className="w-10" onCommit={(v) => upd(r.id, { min: Math.max(0, +v || 0) })} />~<Field value={r.max} type="number" className="w-10" onCommit={(v) => upd(r.id, { max: Math.max(0, +v || 0) })} /></span>
                  ) : r.min === r.max ? r.min : `${r.min}~${r.max}`}</td>
                  <td className="tabular-nums">{exp.toFixed(2)}</td>
                  {sim && <td className="tabular-nums">{sim.counts[r.id] ?? 0}회 ({(((sim.counts[r.id] ?? 0) / (sim.n * Math.max(1, d.rolls))) * 100).toFixed(1)}%) · {sim.qty[r.id] ?? 0}개</td>}
                  {editing && <td><Btn title="삭제" onClick={() => set({ ...d, rows: d.rows.filter((x) => x.id !== r.id) })}><Trash2 size={12} /></Btn></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="nb-row mt-2 text-xs text-muted">
        <span>한 번에 {editing ? <Field value={d.rolls} type="number" className="mx-1 inline-block w-12" onCommit={(v) => set({ ...d, rolls: Math.max(1, +v || 1) })} /> : <b className="text-foreground">{d.rolls}</b>}번 뽑기 · 가중치 합 {total}</span>
        {editing && <Btn onClick={() => set({ ...d, rows: [...d.rows, { id: uid(), name: "", weight: 10, min: 1, max: 1, rarity: "common" }] })}><Plus size={12} /> 항목 추가</Btn>}
        {sim && <span>· 처치 {sim.n.toLocaleString()}번 기준</span>}
      </div>
    </Shell>
  );
}
