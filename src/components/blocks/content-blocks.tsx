"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Btn, Field, SWATCHES, Shell, move, uid, useBlockData, type AnyBlock, type AnyEditor } from "./common";

/* ------------------------------------------------------------------ */
/* Callout                                                             */
/* ------------------------------------------------------------------ */

const CALLOUT_EMOJI = ["💡", "⚠️", "📌", "✅", "❗", "🎮", "⚔️", "🛡️", "🏰", "💎", "🔥", "🧪", "🗺️", "📝"];
export const CALLOUT_COLORS: Record<string, string> = {
  gray: "var(--nb-gray)", blue: "var(--nb-blue)", green: "var(--nb-green)", yellow: "var(--nb-yellow)",
  orange: "var(--nb-orange)", red: "var(--nb-red)", purple: "var(--nb-purple)",
};

export function CalloutView({ block, editor, contentRef }: { block: AnyBlock; editor: AnyEditor; contentRef: (el: HTMLElement | null) => void }) {
  const [open, setOpen] = useState(false);
  const set = (props: Record<string, string>) => editor.updateBlock(block.id, { props });
  return (
    <div className="nb-callout" style={{ background: CALLOUT_COLORS[block.props.color] ?? CALLOUT_COLORS.gray }}>
      <div className="relative shrink-0" contentEditable={false}>
        <button type="button" className="nb-callout-emoji" onClick={() => editor.isEditable && setOpen((v) => !v)}>{block.props.emoji}</button>
        {open && (
          <div className="nb-pop" onMouseLeave={() => setOpen(false)}>
            <div className="grid grid-cols-7 gap-0.5">
              {CALLOUT_EMOJI.map((e) => <button type="button" key={e} className="rounded p-1 text-lg hover:bg-hover" onClick={() => { set({ emoji: e }); setOpen(false); }}>{e}</button>)}
            </div>
            <div className="mt-1 flex gap-1 border-t border-line pt-1.5">
              {Object.entries(CALLOUT_COLORS).map(([k, c]) => (
                <button type="button" key={k} title={k} onClick={() => set({ color: k })}
                  className={`h-5 w-5 rounded-full border ${block.props.color === k ? "border-foreground" : "border-line"}`} style={{ background: c }} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="nb-callout-text" ref={contentRef} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal scrolling cards                                          */
/* ------------------------------------------------------------------ */

interface Card { id: string; title: string; tag: string; text: string; image: string }
interface CardsData { width: number; pixel: boolean; cards: Card[] }
export const CARDS_DEFAULT: CardsData = {
  width: 220, pixel: false,
  cards: [
    { id: "a", title: "숲 바이옴", tag: "지상", text: "초반 거점. 나무·버섯·슬라임", image: "" },
    { id: "b", title: "지하 동굴", tag: "지하 1층", text: "철·구리 광맥, 박쥐", image: "" },
    { id: "c", title: "용암 지대", tag: "최하층", text: "흑요석, 화염 저항 필요", image: "" },
  ],
};

export function CardsView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, CARDS_DEFAULT);
  const strip = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState(false);
  const fileFor = useRef<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const editing = editable && edit;
  const upd = (id: string, f: Partial<Card>) => set((x) => ({ ...x, cards: x.cards.map((c) => (c.id === id ? { ...c, ...f } : c)) }));
  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * (d.width + 12) * 2, behavior: "smooth" });

  return (
    <Shell icon="🃏" title="카드" actions={
      <>
        <Btn title="왼쪽" onClick={() => scroll(-1)}><ChevronLeft size={14} /></Btn>
        <Btn title="오른쪽" onClick={() => scroll(1)}><ChevronRight size={14} /></Btn>
        {editable && <Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "편집"}</Btn>}
      </>
    }>
      <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f || !fileFor.current) return;
        const url = await editor.uploadFile(f);
        upd(fileFor.current, { image: String(url) });
      }} />
      {editing && (
        <div className="nb-row mb-2">
          <label className="nb-label">카드 너비 <input type="range" min={140} max={360} value={d.width} onChange={(e) => set({ ...d, width: +e.target.value })} /></label>
          <label className="nb-label"><input type="checkbox" checked={d.pixel} onChange={(e) => set({ ...d, pixel: e.target.checked })} /> 픽셀 아트 선명하게</label>
        </div>
      )}
      <div ref={strip} className="nb-hscroll">
        {d.cards.map((c, i) => (
          <div key={c.id} className="nb-card" style={{ width: d.width }}>
            <div className="nb-card-img" style={{ imageRendering: d.pixel ? "pixelated" : undefined }}>
              {c.image ? <img src={c.image} alt="" style={{ imageRendering: d.pixel ? "pixelated" : undefined }} /> : <span>🖼️</span>}
              {editing && (
                <button type="button" className="nb-card-imgbtn" onClick={() => { fileFor.current = c.id; file.current?.click(); }}><ImagePlus size={14} /></button>
              )}
            </div>
            <div className="p-2.5">
              {editing ? (
                <>
                  <Field value={c.title} placeholder="제목" className="font-semibold" onCommit={(v) => upd(c.id, { title: v })} />
                  <Field value={c.tag} placeholder="태그" className="text-xs" onCommit={(v) => upd(c.id, { tag: v })} />
                  <Field value={c.text} placeholder="설명" multiline className="text-sm" onCommit={(v) => upd(c.id, { text: v })} />
                  <div className="mt-1 flex gap-1">
                    <Btn title="앞으로" onClick={() => set((x) => ({ ...x, cards: move(x.cards, i, -1) }))}><ArrowLeft size={12} /></Btn>
                    <Btn title="뒤로" onClick={() => set((x) => ({ ...x, cards: move(x.cards, i, 1) }))}><ArrowRight size={12} /></Btn>
                    <Btn title="삭제" onClick={() => set((x) => ({ ...x, cards: x.cards.filter((y) => y.id !== c.id) }))}><Trash2 size={12} /></Btn>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <b className="truncate text-sm">{c.title || "제목 없음"}</b>
                    {c.tag && <span className="nb-chip">{c.tag}</span>}
                  </div>
                  {c.text && <p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">{c.text}</p>}
                </>
              )}
            </div>
          </div>
        ))}
        {editing && (
          <button type="button" className="nb-card nb-card-add" style={{ width: Math.min(d.width, 160) }}
            onClick={() => set((x) => ({ ...x, cards: [...x.cards, { id: uid(), title: "", tag: "", text: "", image: "" }] }))}>
            <Plus size={18} /> 카드 추가
          </button>
        )}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

interface Ev { id: string; date: string; title: string; text: string; color: string }
interface TimelineData { mode: "vertical" | "horizontal"; events: Ev[] }
export const TIMELINE_DEFAULT: TimelineData = {
  mode: "vertical",
  events: [
    { id: "a", date: "태초", title: "대붕괴", text: "하늘섬이 부서지고 대지가 갈라진다.", color: "#8b5cf6" },
    { id: "b", date: "1년", title: "첫 이동 성채", text: "떠돌이 장인들이 걷는 요새를 만든다.", color: "#f97316" },
    { id: "c", date: "37년", title: "성채 연합", text: "성채끼리 교역로를 연다.", color: "#22c55e" },
  ],
};

const natural = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true });

export function TimelineView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, TIMELINE_DEFAULT);
  const [edit, setEdit] = useState(false);
  const editing = editable && edit;
  const upd = (id: string, f: Partial<Ev>) => set((x) => ({ ...x, events: x.events.map((e) => (e.id === id ? { ...e, ...f } : e)) }));

  const item = (e: Ev, i: number) => editing ? (
    <div className="space-y-0.5">
      <Field value={e.date} placeholder="연도·날짜" className="text-xs font-semibold" onCommit={(v) => upd(e.id, { date: v })} />
      <Field value={e.title} placeholder="사건" className="font-semibold" onCommit={(v) => upd(e.id, { title: v })} />
      <Field value={e.text} placeholder="설명" multiline className="text-sm" onCommit={(v) => upd(e.id, { text: v })} />
      <div className="flex flex-wrap items-center gap-1">
        {SWATCHES.map((c) => <button type="button" key={c} onClick={() => upd(e.id, { color: c })} className={`h-4 w-4 rounded-full ${e.color === c ? "ring-2 ring-foreground/40" : ""}`} style={{ background: c }} />)}
        <Btn title="위로" onClick={() => set((x) => ({ ...x, events: move(x.events, i, -1) }))}><ArrowLeft size={12} className={d.mode === "vertical" ? "rotate-90" : ""} /></Btn>
        <Btn title="아래로" onClick={() => set((x) => ({ ...x, events: move(x.events, i, 1) }))}><ArrowRight size={12} className={d.mode === "vertical" ? "rotate-90" : ""} /></Btn>
        <Btn title="삭제" onClick={() => set((x) => ({ ...x, events: x.events.filter((y) => y.id !== e.id) }))}><Trash2 size={12} /></Btn>
      </div>
    </div>
  ) : (
    <>
      <div className="text-xs font-semibold" style={{ color: e.color }}>{e.date}</div>
      <div className="text-sm font-semibold">{e.title}</div>
      {e.text && <p className="whitespace-pre-wrap text-[13px] text-muted">{e.text}</p>}
    </>
  );

  return (
    <Shell icon="🕰️" title="연대표" actions={
      <>
        <Btn active={d.mode === "vertical"} onClick={() => editable && set({ ...d, mode: "vertical" })}>세로</Btn>
        <Btn active={d.mode === "horizontal"} onClick={() => editable && set({ ...d, mode: "horizontal" })}>가로</Btn>
        {editable && <Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "편집"}</Btn>}
      </>
    }>
      {d.mode === "vertical" ? (
        <div className="nb-tl-v">
          {d.events.map((e, i) => (
            <div key={e.id} className="nb-tl-v-item">
              <span className="nb-tl-dot" style={{ background: e.color }} />
              <div className="min-w-0 flex-1">{item(e, i)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="nb-hscroll nb-tl-h">
          {d.events.map((e, i) => (
            <div key={e.id} className="nb-tl-h-item">
              <span className="nb-tl-dot" style={{ background: e.color }} />
              <div className="nb-tl-h-body">{item(e, i)}</div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <div className="nb-row mt-2">
          <Btn onClick={() => set((x) => ({ ...x, events: [...x.events, { id: uid(), date: "", title: "", text: "", color: SWATCHES[x.events.length % SWATCHES.length] }] }))}>
            <Plus size={12} /> 사건 추가
          </Btn>
          <Btn onClick={() => set((x) => ({ ...x, events: [...x.events].sort((a, b) => natural(a.date, b.date)) }))}>날짜순 정렬</Btn>
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Crafting recipes                                                    */
/* ------------------------------------------------------------------ */

interface Stack { name: string; qty: number }
interface Recipe { id: string; station: string; inputs: Stack[]; output: Stack; time: string }
interface RecipeData { recipes: Recipe[] }
export const RECIPE_DEFAULT: RecipeData = {
  recipes: [
    { id: "a", station: "작업대", inputs: [{ name: "나무", qty: 10 }, { name: "철 주괴", qty: 2 }], output: { name: "성채 다리 프레임", qty: 1 }, time: "5초" },
    { id: "b", station: "용광로", inputs: [{ name: "철광석", qty: 3 }], output: { name: "철 주괴", qty: 1 }, time: "2초" },
  ],
};

export function RecipeView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, RECIPE_DEFAULT);
  const [edit, setEdit] = useState(false);
  const editing = editable && edit;
  const upd = (id: string, f: (r: Recipe) => Recipe) => set((x) => ({ ...x, recipes: x.recipes.map((r) => (r.id === id ? f(r) : r)) }));
  const chip = (s: Stack, onName: (v: string) => void, onQty: (v: number) => void, onDel?: () => void) => editing ? (
    <span className="nb-stack">
      <Field value={s.name} placeholder="재료" className="w-24" onCommit={onName} />
      <span>×</span>
      <Field value={s.qty} type="number" className="w-12" onCommit={(v) => onQty(Math.max(0, +v || 0))} />
      {onDel && <button type="button" className="text-muted" onClick={onDel}>×</button>}
    </span>
  ) : (
    <span className="nb-stack"><b>{s.name}</b>{s.qty !== 1 && <span className="text-muted">×{s.qty}</span>}</span>
  );

  return (
    <Shell icon="⚒️" title="제작 레시피" actions={editable && <Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "편집"}</Btn>}>
      <div className="space-y-1.5">
        {d.recipes.map((r) => (
          <div key={r.id} className="nb-recipe">
            <div className="flex flex-wrap items-center gap-1.5">
              {r.inputs.map((s, i) => (
                <span key={i} className="contents">
                  {i > 0 && <span className="text-muted">+</span>}
                  {chip(s,
                    (v) => upd(r.id, (x) => ({ ...x, inputs: x.inputs.map((y, j) => (j === i ? { ...y, name: v } : y)) })),
                    (v) => upd(r.id, (x) => ({ ...x, inputs: x.inputs.map((y, j) => (j === i ? { ...y, qty: v } : y)) })),
                    () => upd(r.id, (x) => ({ ...x, inputs: x.inputs.filter((_, j) => j !== i) })))}
                </span>
              ))}
              {editing && <Btn onClick={() => upd(r.id, (x) => ({ ...x, inputs: [...x.inputs, { name: "", qty: 1 }] }))}><Plus size={11} /></Btn>}
              <span className="px-1 text-muted">→</span>
              {chip(r.output, (v) => upd(r.id, (x) => ({ ...x, output: { ...x.output, name: v } })), (v) => upd(r.id, (x) => ({ ...x, output: { ...x.output, qty: v } })))}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted">
              {editing ? (
                <>
                  <Field value={r.station} placeholder="제작대" className="w-28" onCommit={(v) => upd(r.id, (x) => ({ ...x, station: v }))} />
                  <Field value={r.time} placeholder="시간" className="w-16" onCommit={(v) => upd(r.id, (x) => ({ ...x, time: v }))} />
                  <Btn title="삭제" onClick={() => set((x) => ({ ...x, recipes: x.recipes.filter((y) => y.id !== r.id) }))}><Trash2 size={12} /></Btn>
                </>
              ) : (
                <>{r.station && <span>🔨 {r.station}</span>}{r.time && <span>⏱ {r.time}</span>}</>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div className="mt-2"><Btn onClick={() => set((x) => ({ ...x, recipes: [...x.recipes, { id: uid(), station: "", inputs: [{ name: "", qty: 1 }], output: { name: "", qty: 1 }, time: "" }] }))}><Plus size={12} /> 레시피 추가</Btn></div>
      )}
    </Shell>
  );
}
