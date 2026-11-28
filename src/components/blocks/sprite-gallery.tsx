"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ListPlus, Plus, Trash2, Upload, X } from "lucide-react";
import { Btn, Field, Shell, uid, useBlockData, type AnyBlock, type AnyEditor } from "./common";
import { download, framesToGif, loadImage, sheetFrames, sheetToGif } from "@/lib/gif";

interface Stat { k: string; v: string }
interface Sprite {
  id: string; name: string; tag: string; desc: string; note: string; gif: string; w?: number; h?: number;
  tier?: string; stats?: Stat[]; lore?: string; tip?: string;
}

const TIERS: Record<string, string> = { 시작: "#9ca3af", 초반: "#22c55e", 중반: "#3b82f6", 후반: "#a855f7", 유물: "#f59e0b" };

/** Whole-number pixel scale for a sprite: small parts ×3, most modules ×2, the very large ones ×1. */
const pixelScale = (s: Sprite) => (!s.w || !s.h ? 0 : Math.max(s.w, s.h) <= 50 ? 3 : Math.max(s.w, s.h) <= 120 ? 2 : 1);

/** Pixel art shown at a whole-number scale (crisp). In the grid it also shrinks to fit the card. */
function Sprite({ s, maxW, maxH, onClick }: { s: Sprite; maxW?: number; maxH?: number; onClick: () => void }) {
  const base = pixelScale(s);
  const k = base && maxW && maxH ? Math.max(1, Math.min(base, Math.floor(Math.min(maxW / s.w!, maxH / s.h!)))) : base;
  return (
    <button type="button" className="nb-stage-btn" onClick={onClick} title="크게 보기">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={s.gif} alt={s.name} loading="lazy"
        style={k ? { width: s.w! * k, height: s.h! * k, maxWidth: "100%", maxHeight: "100%" } : { maxWidth: "100%", maxHeight: "100%" }} />
      <span className="nb-shadow" style={{ width: k ? s.w! * k * 0.8 : "60%" }} />
    </button>
  );
}

/** List stage sized around the sprite (the sprite never gets squeezed). */
const stageSize = (s: Sprite, width: number) => {
  const k = pixelScale(s);
  if (!s.gif || !k) return { width, height: 150 };
  return { width, height: Math.max(130, s.h! * k + 30) };
};
/** One stage width for the whole list, so the text column lines up. */
const listStageWidth = (items: Sprite[]) =>
  Math.min(360, Math.max(210, ...items.map((s) => (s.gif && pixelScale(s) ? s.w! * pixelScale(s) + 28 : 0))));

/** Full-screen view of one sprite: big crisp sprite, stats, lore. Rendered on <body>, outside the editor. */
function Zoom({ s, onClose }: { s: Sprite; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const vw = typeof window !== "undefined" ? window.innerWidth : 800;
  const k = s.w && s.h ? Math.max(1, Math.min(8, Math.floor(Math.min((Math.min(vw, 720) - 64) / s.w, 300 / s.h)))) : 0;
  return createPortal(
    <div className="nb-zoom" onClick={onClose}>
      <div className="nb-zoom-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="nb-zoom-x" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        <div className="nb-hangar nb-zoom-stage">
          <div className="nb-stage-btn" style={{ cursor: "default" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.gif} alt={s.name} style={k ? { width: s.w! * k, height: s.h! * k } : { maxWidth: "100%", maxHeight: 300 }} />
            <span className="nb-shadow" style={{ width: k ? s.w! * k * 0.8 : "60%" }} />
          </div>
        </div>
        <div className="nb-zoom-body">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{s.name}</span>
            {s.tier && <span className="nb-tier" style={{ color: TIERS[s.tier], borderColor: TIERS[s.tier] }}>{s.tier}</span>}
            {s.tag && <span className="text-xs opacity-60">{s.tag}</span>}
          </div>
          {s.desc && <p className="mt-1 text-sm opacity-90">{s.desc}</p>}
          {!!s.stats?.length && (
            <dl className="nb-stats">
              {s.stats.map((x, i) => <div key={i} className={x.v.length > 22 ? "nb-stat-wide" : ""}><dt>{x.k}</dt><dd>{x.v}</dd></div>)}
            </dl>
          )}
          {s.lore && <p className="nb-lore">{s.lore}</p>}
          {s.tip && <p className="mt-2 text-xs opacity-70">💡 {s.tip}</p>}
          <a href={s.gif} download={`${s.name || "sprite"}.gif`} className="nb-btn mt-3 inline-flex"><Download size={13} /> GIF 받기</a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const statsText = (st?: Stat[]) => (st ?? []).map((x) => `${x.k}: ${x.v}`).join("\n");
const parseStats = (t: string): Stat[] => t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf(":");
  return i > 0 ? { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() } : { k: l, v: "" };
});
interface GalleryData { layout: "list" | "grid"; size: number; bg: "checker" | "dark" | "light"; items: Sprite[] }
export const GALLERY_DEFAULT: GalleryData = { layout: "list", size: 112, bg: "dark", items: [] };

const cellText = (cell: AnyBlock): string => {
  const content = Array.isArray(cell) ? cell : cell?.content;
  return Array.isArray(content) ? content.map((c: AnyBlock) => (c.type === "text" ? c.text : c.type === "link" ? cellText(c.content) : "")).join("").trim() : "";
};

type Found = { name: string; tag: string; desc: string; note: string };

/** Rows of a table → items: first column = name, 효과/설명 = description, the rest = a short detail line. */
export function itemsFromTable(table: AnyBlock, tag: string): Found[] {
  const rows: AnyBlock[] = table.content?.rows ?? [];
  if (rows.length < 2) return [];
  const head = (rows[0].cells ?? []).map((c: AnyBlock) => cellText(c));
  const col = (re: RegExp) => head.findIndex((h: string) => re.test(h));
  const descAt = col(/효과|설명|역할|기능/);
  const noteAt = col(/비고|메모/);
  const statAt = head.map((h: string, i: number) => (/크기|무게|전력|인력|비용|체력/.test(h) ? i : -1)).filter((i: number) => i > 0);
  return rows.slice(1).map((r: AnyBlock) => {
    const cells = (r.cells ?? []).map((c: AnyBlock) => cellText(c).replace(/\s+/g, " "));
    const stats = statAt.map((i: number) => (cells[i] ? `${head[i]} ${cells[i]}` : "")).filter(Boolean);
    return {
      name: cells[0] ?? "",
      tag,
      desc: descAt > 0 ? cells[descAt] ?? "" : cells.slice(1).filter(Boolean).join(" · "),
      note: [...stats, noteAt > 0 ? cells[noteAt] : ""].filter(Boolean).join(" · "),
    };
  }).filter((x: Found) => x.name);
}

/**
 * Items from this page's tables. If the block sits right under a table, only that table;
 * otherwise every table, tagged with the heading above it.
 */
function namesFromTables(doc: AnyBlock[], blockId: string): Found[] {
  const at = doc.findIndex((b) => b.id === blockId);
  const headingBefore = (i: number) => {
    for (let k = i; k >= 0; k--) if (doc[k].type === "heading") return cellText(doc[k].content).replace(/^\d+[.)]\s*/, "");
    return "";
  };
  if (at > 0 && doc[at - 1].type === "table") return itemsFromTable(doc[at - 1], headingBefore(at - 1));
  return doc.flatMap((b, i) => (b.type === "table" ? itemsFromTable(b, headingBefore(i)) : []));
}

export function SpriteGalleryView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, GALLERY_DEFAULT);
  const [edit, setEdit] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<Sprite | null>(null);
  const [zoom, setZoom] = useState<Sprite | null>(null);
  const editing = editable && edit;
  const tags = useMemo(() => [...new Set(d.items.map((i) => i.tag).filter(Boolean))], [d.items]);
  const shown = filter ? d.items.filter((i) => i.tag === filter) : d.items;
  const stageW = listStageWidth(d.items);
  const done = d.items.filter((i) => i.gif).length;
  const upd = (id: string, f: Partial<Sprite>) => set((x) => ({ ...x, items: x.items.map((i) => (i.id === id ? { ...i, ...f } : i)) }));

  const importNames = () => {
    const found = namesFromTables(editor.document, block.id);
    const have = new Set(d.items.map((i) => i.name));
    const add = found.filter((f) => !have.has(f.name));
    if (!found.length) return alert("이 페이지에서 표를 찾지 못했어요. 표의 첫 번째 열을 모듈 이름으로 읽어요.");
    if (!add.length) return alert("표에 있는 모듈은 이미 모두 들어 있어요.");
    set((x) => ({ ...x, items: [...x.items, ...add.map((a) => ({ id: uid(), ...a, gif: "" }))] }));
  };

  const bg = d.bg === "checker" ? "nb-checker" : d.bg === "light" ? "bg-white" : "bg-[#0b1020]";

  return (
    <Shell bare className={editing ? "nb-editing" : ""} icon="🎞️" title={`스프라이트 도감 · ${done}/${d.items.length}`} actions={
      <>
        <Btn active={d.layout === "list"} onClick={() => editable && set({ ...d, layout: "list" })}>목록</Btn>
        <Btn active={d.layout === "grid"} onClick={() => editable && set({ ...d, layout: "grid" })}>격자</Btn>
        {editable && <Btn title="표의 첫 열(모듈 이름)·효과·비고를 항목으로 불러오기 (바로 위에 표가 있으면 그 표만)" onClick={importNames}><ListPlus size={13} /> 표에서 불러오기</Btn>}
        {editable && <span className="nb-keep"><Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "편집"}</Btn></span>}
      </>
    }>
      {(tags.length > 1 || editing) && (
        <div className="nb-row mb-2">
          {tags.length > 1 && (
            <>
              <Btn active={!filter} onClick={() => setFilter(null)}>전체 {d.items.length}</Btn>
              {tags.map((t) => <Btn key={t} active={filter === t} onClick={() => setFilter(filter === t ? null : t)}>{t} {d.items.filter((i) => i.tag === t).length}</Btn>)}
            </>
          )}
          {editing && (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <label className="nb-label">크기 <input type="range" min={56} max={280} value={d.size} onChange={(e) => set({ ...d, size: +e.target.value })} /></label>
              {(["dark", "checker", "light"] as const).map((b) => <Btn key={b} active={d.bg === b} onClick={() => set({ ...d, bg: b })}>{b === "dark" ? "어둡게" : b === "checker" ? "격자" : "밝게"}</Btn>)}
            </span>
          )}
        </div>
      )}

      {d.items.length === 0 && (
        <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          모듈마다 스프라이트 애니메이션(GIF)을 모아 보는 곳이에요.
          {editable && <> <b className="text-foreground">표에서 불러오기</b>로 이 페이지 표의 모듈 이름을 한 번에 넣거나, 편집 → 항목 추가로 시작하세요.</>}
        </div>
      )}

      {d.layout === "list" && (
        <div className="nb-slist">
          {shown.map((s) => (
            <div key={s.id} className="nb-srow">
              <div className={`nb-hangar nb-srow-img ${d.bg === "dark" ? "" : bg}`} style={stageSize(s, stageW)}>
                {s.gif ? (
                  <Sprite s={s} onClick={() => setZoom(s)} />
                ) : editable ? (
                  <button type="button" className="nb-gempty" onClick={() => setUploadFor(s)}><Upload size={16} />올리기</button>
                ) : (
                  <span className="text-xs text-white/40">아직 없음</span>
                )}
                {s.gif && editing && (
                  <button type="button" title="바꾸기" className="nb-card-imgbtn" onClick={() => setUploadFor(s)}><Upload size={12} /></button>
                )}
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                {editing ? (
                  <div className="space-y-0.5">
                    <Field value={s.name} placeholder="모듈 이름" className="font-semibold" onCommit={(v) => upd(s.id, { name: v })} />
                    <Field value={s.desc} placeholder="설명" multiline className="text-sm" onCommit={(v) => upd(s.id, { desc: v })} />
                    <Field value={s.note} placeholder="메모" className="text-xs" onCommit={(v) => upd(s.id, { note: v })} />
                    <Field value={statsText(s.stats)} placeholder={"성능 (한 줄에 하나)\n크기: 4×3칸\n무게: 28t"} multiline className="font-mono text-xs" onCommit={(v) => upd(s.id, { stats: parseStats(v) })} />
                    <Field value={s.lore ?? ""} placeholder="배경 설정" multiline className="text-xs" onCommit={(v) => upd(s.id, { lore: v })} />
                    <Field value={s.tip ?? ""} placeholder="운영 팁" className="text-xs" onCommit={(v) => upd(s.id, { tip: v })} />
                    <div className="flex items-center gap-1">
                      <select className="nb-field w-auto text-xs" value={s.tier ?? ""} onChange={(e) => upd(s.id, { tier: e.target.value || undefined })}>
                        <option value="">등급 없음</option>
                        {Object.keys(TIERS).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <Field value={s.tag} placeholder="분류" className="w-32 text-xs" onCommit={(v) => upd(s.id, { tag: v })} />
                      {s.gif && <Btn title="GIF 지우기" onClick={() => upd(s.id, { gif: "", w: undefined, h: undefined })}><X size={12} /></Btn>}
                      <Btn title="항목 삭제" onClick={() => set((x) => ({ ...x, items: x.items.filter((i) => i.id !== s.id) }))}><Trash2 size={12} /></Btn>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{s.name || "이름 없음"}</span>
                      {s.tier && <span className="nb-tier" style={{ color: TIERS[s.tier] ?? "inherit", borderColor: TIERS[s.tier] ?? "currentColor" }}>{s.tier}</span>}
                    </div>
                    {s.desc && <p className="mt-0.5 whitespace-pre-wrap text-sm">{s.desc}</p>}
                    {!!s.stats?.length && (
                      <dl className="nb-stats">
                        {s.stats.map((x, i) => (
                          <div key={i} className={x.v.length > 22 ? "nb-stat-wide" : ""}><dt>{x.k}</dt><dd>{x.v}</dd></div>
                        ))}
                      </dl>
                    )}
                    {s.lore && (
                      <details className="nb-lore-d">
                        <summary>배경 설정</summary>
                        <p className="nb-lore">{s.lore}</p>
                      </details>
                    )}
                    {s.tip && <p className="mt-1.5 text-xs text-muted">💡 {s.tip}</p>}
                    {s.note && !s.stats?.length && <p className="mt-1 text-xs text-muted">{s.note}</p>}
                  </>
                )}
              </div>
            </div>
          ))}
          {editing && (
            <Btn onClick={() => set((x) => ({ ...x, items: [...x.items, { id: uid(), name: "", tag: filter ?? "", desc: "", note: "", gif: "" }] }))}><Plus size={12} /> 항목 추가</Btn>
          )}
        </div>
      )}

      {d.layout === "grid" && <div className="nb-gallery" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${d.size}px, 1fr))` }}>
        {shown.map((s) => (
          <div key={s.id} className="nb-gcard">
            <div className={`nb-hangar ${d.bg === "dark" ? "" : bg}`} style={{ height: Math.max(100, d.size) * 0.8 }}>
              {s.gif ? (
                <Sprite s={s} maxW={Math.max(100, d.size) - 12} maxH={Math.max(100, d.size) * 0.8 - 18} onClick={() => setZoom(s)} />
              ) : editable ? (
                <button type="button" className="nb-gempty" onClick={() => setUploadFor(s)}><Upload size={16} />스프라이트 올리기</button>
              ) : (
                <span className="text-xs text-white/40">아직 없음</span>
              )}
              {s.gif && editing && (
                <button type="button" title="바꾸기" className="nb-card-imgbtn" onClick={() => setUploadFor(s)}><Upload size={12} /></button>
              )}
            </div>
            <div className="px-2 py-1.5">
              {editing ? (
                <>
                  <Field value={s.name} placeholder="모듈 이름" className="text-sm font-semibold" onCommit={(v) => upd(s.id, { name: v })} />
                  <Field value={s.tag} placeholder="분류" className="text-xs" onCommit={(v) => upd(s.id, { tag: v })} />
                  <Field value={s.note} placeholder="메모 (프레임 수, 상태 등)" className="text-xs" onCommit={(v) => upd(s.id, { note: v })} />
                  <div className="mt-0.5 flex gap-1">
                    {s.gif && <Btn title="GIF 지우기" onClick={() => upd(s.id, { gif: "", w: undefined, h: undefined })}><X size={12} /></Btn>}
                    <Btn title="항목 삭제" onClick={() => set((x) => ({ ...x, items: x.items.filter((i) => i.id !== s.id) }))}><Trash2 size={12} /></Btn>
                  </div>
                </>
              ) : (
                <>
                  <div className="truncate text-sm font-semibold" title={s.name}>{s.name || "이름 없음"}</div>
                  {s.desc && <div className="line-clamp-2 text-[11px]">{s.desc}</div>}
                  <div className="truncate text-[11px] text-muted">{[s.tag, s.note].filter(Boolean).join(" · ")}</div>
                </>
              )}
            </div>
          </div>
        ))}
        {editing && (
          <button type="button" className="nb-gcard nb-card-add" style={{ minHeight: d.size * 0.8 + 40 }}
            onClick={() => set((x) => ({ ...x, items: [...x.items, { id: uid(), name: "", tag: filter ?? "", desc: "", note: "", gif: "" }] }))}>
            <Plus size={18} /> 항목 추가
          </button>
        )}
      </div>}

      {uploadFor && (
        <SpriteUpload
          name={uploadFor.name}
          onClose={() => setUploadFor(null)}
          onDone={async (gif, w, h) => {
            const file = new File([gif], `${uploadFor.name || "sprite"}.gif`, { type: "image/gif" });
            const url = String(await editor.uploadFile(file));
            upd(uploadFor.id, { gif: url, w, h });
            setUploadFor(null);
          }}
        />
      )}
      {zoom && <Zoom s={zoom} onClose={() => setZoom(null)} />}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Upload: GIF as-is, or a sprite sheet / separate frames → GIF        */
/* ------------------------------------------------------------------ */

type Source =
  | { kind: "gif"; file: File; url: string; w: number; h: number }
  | { kind: "sheet"; img: HTMLImageElement; url: string }
  | { kind: "frames"; imgs: HTMLImageElement[] };

function SpriteUpload({ name, onClose, onDone }: { name: string; onClose: () => void; onDone: (gif: Blob, w: number, h: number) => Promise<void> }) {
  const [src, setSrc] = useState<Source | null>(null);
  const [fw, setFw] = useState(32);
  const [fh, setFh] = useState(32);
  const [frames, setFrames] = useState(0);
  const [fps, setFps] = useState(10);
  const [scale, setScale] = useState(2);
  const [pingpong, setPingpong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);

  const pick = async (files: File[]) => {
    setError(null);
    if (!files.length) return;
    try {
      if (files.length === 1 && files[0].type === "image/gif") {
        const url = URL.createObjectURL(files[0]);
        const img = await loadImage(url);
        setSrc({ kind: "gif", file: files[0], url, w: img.width, h: img.height });
      } else if (files.length === 1) {
        const url = URL.createObjectURL(files[0]);
        const img = await loadImage(url);
        // Guess: one row of square frames, else the whole image is one frame.
        const square = img.width % img.height === 0 ? img.height : img.width;
        setFw(square); setFh(img.height); setFrames(0);
        setSrc({ kind: "sheet", img, url });
      } else {
        const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const imgs = await Promise.all(sorted.map((f) => loadImage(URL.createObjectURL(f))));
        setSrc({ kind: "frames", imgs });
      }
    } catch (e) { setError((e as Error).message); }
  };

  // Live preview
  const count = !src ? 0 : src.kind === "frames" ? src.imgs.length : src.kind === "sheet" ? sheetFrames(src.img.width, src.img.height, { fw, fh, frames, fps }).length : 1;
  useEffect(() => {
    if (!src || src.kind === "gif" || count < 1) return;
    let i = 0, dir = 1;
    const id = setInterval(() => {
      if (pingpong && count > 2) { i += dir; if (i >= count - 1 || i <= 0) dir = -dir; } else i = (i + 1) % count;
      setCur(i);
    }, 1000 / Math.max(1, fps));
    return () => clearInterval(id);
  }, [src, count, fps, pingpong]);
  useEffect(() => {
    const c = cv.current;
    if (!c || !src || src.kind === "gif") return;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    if (src.kind === "sheet") {
      const r = sheetFrames(src.img.width, src.img.height, { fw, fh, frames, fps })[cur % count];
      if (r) g.drawImage(src.img, r.sx, r.sy, fw, fh, 0, 0, c.width, c.height);
    } else {
      const im = src.imgs[cur % count];
      g.drawImage(im, 0, 0, im.width * (c.width / Math.max(...src.imgs.map((x) => x.width))), im.height * (c.height / Math.max(...src.imgs.map((x) => x.height))));
    }
  }, [src, cur, count, fw, fh, frames, fps]);

  const outW = !src ? 0 : src.kind === "gif" ? src.w : src.kind === "sheet" ? fw * scale : Math.max(...src.imgs.map((x) => x.width)) * scale;
  const outH = !src ? 0 : src.kind === "gif" ? src.h : src.kind === "sheet" ? fh * scale : Math.max(...src.imgs.map((x) => x.height)) * scale;

  async function save() {
    if (!src) return;
    setBusy(true);
    setError(null);
    try {
      const gif = src.kind === "gif" ? src.file
        : src.kind === "sheet" ? sheetToGif(src.img, { fw, fh, frames, fps, scale, pingpong })
          : framesToGif(src.imgs, fps, scale, pingpong);
      await onDone(gif, outW, outH);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const n = (v: number, setV: (v: number) => void, min: number, max: number) => (
    <input className="nb-field w-14" type="number" min={min} max={max} value={v} onChange={(e) => setV(Math.max(min, Math.min(max, +e.target.value || min)))} />
  );

  return (
    <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/40 md:items-center" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl md:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <b>{name || "스프라이트"} · 애니메이션 올리기</b>
          <button type="button" disabled={busy} onClick={onClose} className="rounded p-1 hover:bg-hover"><X size={16} /></button>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void pick([...e.dataTransfer.files]); }}
          className="rounded-lg border-2 border-dashed border-line p-4 text-center text-sm"
        >
          <button type="button" className="nb-btn" onClick={() => input.current?.click()}><Upload size={13} /> 파일 고르기</button>
          <p className="mt-2 text-xs text-muted">GIF는 그대로 · 스프라이트 시트 PNG 1장은 프레임을 잘라서 · PNG 여러 장은 이름 순서대로 프레임으로 → GIF로 만들어요</p>
          <input ref={input} type="file" accept="image/gif,image/png,image/webp" multiple hidden onChange={(e) => { void pick([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>

        {src && (
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <div className="nb-checker flex items-center justify-center rounded-md p-2" style={{ minWidth: 96, minHeight: 96 }}>
              {src.kind === "gif" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src.url} alt="" style={{ imageRendering: "pixelated", maxWidth: 200, width: Math.min(src.w * 3, 200) }} />
              ) : (
                <canvas ref={cv} width={Math.min(outW, 200)} height={Math.min(outW, 200) * (outH / Math.max(1, outW))} style={{ imageRendering: "pixelated" }} />
              )}
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5 text-xs">
              {src.kind === "gif" && <p className="text-muted">GIF {src.w}×{src.h}px를 그대로 올려요.</p>}
              {src.kind === "sheet" && (
                <>
                  <p className="text-muted">시트 {src.img.width}×{src.img.height}px · 프레임 {count}개</p>
                  <div className="nb-row"><span className="nb-label">프레임 크기</span>{n(fw, setFw, 1, 2048)}×{n(fh, setFh, 1, 2048)}</div>
                  <div className="nb-row"><span className="nb-label">개수(0=전부)</span>{n(frames, setFrames, 0, 999)}</div>
                </>
              )}
              {src.kind === "frames" && <p className="text-muted">프레임 {src.imgs.length}장 (파일 이름 순서)</p>}
              {src.kind !== "gif" && (
                <>
                  <div className="nb-row"><span className="nb-label">FPS</span>{n(fps, setFps, 1, 50)}<span className="nb-label">GIF 배율</span>{n(scale, setScale, 1, 8)}</div>
                  <label className="nb-label"><input type="checkbox" checked={pingpong} onChange={(e) => setPingpong(e.target.checked)} /> 왕복 재생</label>
                  <p className="text-muted">결과: {outW}×{outH}px GIF</p>
                </>
              )}
            </div>
          </div>
        )}
        {error && <p className="nb-error">{error}</p>}
        <div className="mt-3 flex gap-2">
          {src && src.kind !== "gif" && (
            <button type="button" className="nb-btn" disabled={busy} onClick={() => {
              const gif = src.kind === "sheet" ? sheetToGif(src.img, { fw, fh, frames, fps, scale, pingpong }) : framesToGif(src.imgs, fps, scale, pingpong);
              download(gif, `${name || "sprite"}.gif`);
            }}><Download size={13} /> GIF 받기</button>
          )}
          <button type="button" disabled={!src || busy} onClick={() => void save()}
            className="flex-1 rounded-md bg-accent py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "올리는 중…" : src?.kind === "gif" ? "올리기" : "GIF로 만들어 올리기"}
          </button>
        </div>
      </div>
    </div>
  );
}
