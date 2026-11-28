"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eraser, PaintBucket, Pause, Pencil, Pipette, Play, Plus, SkipBack, SkipForward, Upload } from "lucide-react";
import { Btn, Field, Shell, useBlockData, type AnyBlock, type AnyEditor } from "./common";
import { download, sheetToGif } from "@/lib/gif";

/* ------------------------------------------------------------------ */
/* Sprite sheet animation / effect viewer                              */
/* ------------------------------------------------------------------ */

interface SpriteData {
  url: string; fw: number; fh: number; frames: number; start: number; fps: number; scale: number;
  bg: "checker" | "dark" | "light"; trail: boolean; pingpong: boolean;
}
export const SPRITE_DEFAULT: SpriteData = { url: "", fw: 32, fh: 32, frames: 0, start: 0, fps: 12, scale: 4, bg: "dark", trail: false, pingpong: false };

/** A tiny built-in sheet (8 frames of an explosion) so the block shows something before an upload. */
function demoSheet(): string {
  const c = document.createElement("canvas");
  c.width = 32 * 8; c.height = 32;
  const g = c.getContext("2d")!;
  for (let f = 0; f < 8; f++) {
    const r = 3 + f * 1.8, ox = f * 32 + 16;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + f * 0.3, d = r * (0.6 + ((i * 37) % 10) / 25);
      g.fillStyle = f < 3 ? "#fff7b2" : f < 5 ? "#ffb347" : f < 7 ? "#ff5f3a" : "#6b7280";
      g.fillRect(Math.round(ox + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d), 2, 2);
    }
    if (f < 4) { g.fillStyle = "#ffffff"; g.fillRect(ox - (4 - f), 16 - (4 - f), (4 - f) * 2, (4 - f) * 2); }
  }
  return c.toDataURL();
}

export function SpriteSheetView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, SPRITE_DEFAULT);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [demo] = useState(() => (typeof document !== "undefined" ? demoSheet() : ""));
  const src = d.url || demo;

  useEffect(() => {
    if (!src) return;
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);

  const cols = img ? Math.max(1, Math.floor(img.width / d.fw)) : 1;
  const rows = img ? Math.max(1, Math.floor(img.height / d.fh)) : 1;
  const total = Math.max(1, Math.min(d.frames || cols * rows - d.start, cols * rows - d.start));

  // Playback
  useEffect(() => {
    if (!playing || !img) return;
    let i = 0, dir = 1;
    const id = setInterval(() => {
      if (d.pingpong && total > 1) {
        i += dir;
        if (i >= total - 1 || i <= 0) dir = -dir;
      } else i = (i + 1) % total;
      setCur(i);
    }, 1000 / Math.max(1, d.fps));
    return () => clearInterval(id);
  }, [playing, img, total, d.fps, d.pingpong]);

  // Draw current frame
  useEffect(() => {
    const c = cv.current;
    if (!c || !img) return;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const draw = (n: number, alpha: number) => {
      const k = d.start + n, sx = (k % cols) * d.fw, sy = Math.floor(k / cols) * d.fh;
      g.globalAlpha = alpha;
      g.drawImage(img, sx, sy, d.fw, d.fh, 0, 0, c.width, c.height);
    };
    g.globalAlpha = 1;
    g.clearRect(0, 0, c.width, c.height);
    if (d.trail) for (let k = 3; k >= 1; k--) draw((cur - k + total * 4) % total, 0.18 * (4 - k) / 3);
    draw(cur % total, 1);
    g.globalAlpha = 1;
  }, [img, cur, d, cols, total]);

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const url = String(await editor.uploadFile(f));
      const probe = new Image();
      probe.onload = () => {
        // Guess the frame size: square frames in a single row, or keep the current size.
        const guess = probe.height <= 256 && probe.width % probe.height === 0 ? probe.height : d.fw;
        set({ ...d, url, fw: guess, fh: probe.width % probe.height === 0 ? probe.height : d.fh, frames: 0, start: 0 });
      };
      probe.src = url;
    } finally { setBusy(false); }
  };

  const bgClass = d.bg === "checker" ? "nb-checker" : d.bg === "light" ? "bg-white" : "bg-[#0b1020]";
  const num = (k: keyof SpriteData, min: number, max: number) => (
    <input className="nb-field w-14" type="number" min={min} max={max} value={d[k] as number} readOnly={!editable}
      onChange={(e) => set({ ...d, [k]: Math.max(min, Math.min(max, +e.target.value || 0)) })} />
  );

  return (
    <Shell icon="✨" title="스프라이트 · 이펙트" actions={
      <>
        <Btn title="이전 프레임" onClick={() => { setPlaying(false); setCur((c) => (c - 1 + total) % total); }}><SkipBack size={13} /></Btn>
        <Btn title={playing ? "멈춤" : "재생"} onClick={() => setPlaying((v) => !v)}>{playing ? <Pause size={13} /> : <Play size={13} />}</Btn>
        <Btn title="다음 프레임" onClick={() => { setPlaying(false); setCur((c) => (c + 1) % total); }}><SkipForward size={13} /></Btn>
        <Btn title="지금 설정(프레임·FPS·배율·왕복)으로 GIF 파일 저장" disabled={!img} onClick={() => {
          if (!img) return;
          try { download(sheetToGif(img, { fw: d.fw, fh: d.fh, start: d.start, frames: d.frames, fps: d.fps, scale: Math.min(d.scale, 4), pingpong: d.pingpong }), "sprite.gif"); }
          catch (e) { alert(`GIF를 만들지 못했어요: ${(e as Error).message}`); }
        }}><Download size={13} /> GIF</Btn>
        {editable && <Btn disabled={busy} onClick={() => file.current?.click()}><Upload size={13} /> {busy ? "올리는 중" : "시트 올리기"}</Btn>}
      </>
    }>
      <input ref={file} type="file" accept="image/png,image/gif,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <div className="flex flex-wrap items-start gap-3">
        <div className={`nb-sprite-stage ${bgClass}`}>
          <canvas ref={cv} width={d.fw * d.scale} height={d.fh * d.scale} style={{ maxWidth: "100%", imageRendering: "pixelated" }} />
          <span className="nb-sprite-badge">{(cur % total) + 1}/{total}</span>
        </div>
        <div className="min-w-[220px] flex-1 space-y-1.5 text-xs">
          {!d.url && <p className="text-muted">예시 폭발 이펙트예요. 스프라이트 시트(PNG)를 올리면 프레임을 잘라서 재생해요.</p>}
          <div className="nb-row"><span className="nb-label">프레임 크기</span>{num("fw", 1, 1024)}×{num("fh", 1, 1024)}</div>
          <div className="nb-row"><span className="nb-label">시작</span>{num("start", 0, 9999)}<span className="nb-label">개수(0=전부)</span>{num("frames", 0, 9999)}</div>
          <div className="nb-row"><span className="nb-label">FPS</span>{num("fps", 1, 60)}<span className="nb-label">배율</span>{num("scale", 1, 16)}</div>
          <div className="nb-row">
            {(["dark", "checker", "light"] as const).map((b) => <Btn key={b} active={d.bg === b} onClick={() => editable && set({ ...d, bg: b })}>{b === "dark" ? "어두운 배경" : b === "checker" ? "투명 격자" : "밝은 배경"}</Btn>)}
          </div>
          <div className="nb-row">
            <label className="nb-label"><input type="checkbox" checked={d.trail} disabled={!editable} onChange={(e) => set({ ...d, trail: e.target.checked })} /> 잔상</label>
            <label className="nb-label"><input type="checkbox" checked={d.pingpong} disabled={!editable} onChange={(e) => set({ ...d, pingpong: e.target.checked })} /> 왕복 재생</label>
          </div>
        </div>
      </div>
      {img && (
        <div className="nb-sheet">
          <div className={`relative inline-block ${bgClass}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" style={{ imageRendering: "pixelated", width: Math.min(img.width * 2, 720) }} />
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${img.width} ${img.height}`} preserveAspectRatio="none">
              {Array.from({ length: cols * rows }, (_, k) => {
                const on = k === d.start + (cur % total), inRange = k >= d.start && k < d.start + total;
                return (
                  <rect key={k} x={(k % cols) * d.fw} y={Math.floor(k / cols) * d.fh} width={d.fw} height={d.fh}
                    fill={on ? "rgba(59,130,246,.25)" : "transparent"} stroke={on ? "#3b82f6" : inRange ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.1)"}
                    strokeWidth={Math.max(0.5, img.width / 600)} style={{ cursor: "pointer" }}
                    onClick={() => { if (inRange) { setPlaying(false); setCur(k - d.start); } }} />
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------------ */
/* Pixel art / tile layout editor                                      */
/* ------------------------------------------------------------------ */

interface Swatch { c: string; name: string }
interface PixelArtData { w: number; h: number; cell: number; grid: boolean; palette: Swatch[]; px: string }
const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

export const PIXELART_PRESETS: Record<string, { label: string; data: PixelArtData }> = {
  sprite: {
    label: "16×16 캐릭터 스프라이트",
    data: {
      w: 16, h: 16, cell: 18, grid: true,
      palette: [{ c: "#1f2937", name: "외곽선" }, { c: "#fcd34d", name: "피부" }, { c: "#7c2d12", name: "머리" }, { c: "#2563eb", name: "옷" }, { c: "#9ca3af", name: "금속" }, { c: "#ffffff", name: "하이라이트" }],
      px: "".padEnd(256, "."),
    },
  },
  fortress: {
    label: "이동 성채 모듈 배치도",
    data: {
      w: 24, h: 12, cell: 22, grid: true,
      palette: [
        { c: "#6b7280", name: "갑판/프레임" }, { c: "#ef4444", name: "엔진" }, { c: "#f59e0b", name: "거주 구역" },
        { c: "#3b82f6", name: "창고" }, { c: "#10b981", name: "생산 시설" }, { c: "#111827", name: "포탑" }, { c: "#a855f7", name: "방어막 발생기" }, { c: "#78350f", name: "다리" },
      ],
      px: [
        "........................",
        "........5.......5.......",
        ".....222.33333..44......",
        ".....222.33333..44..6...",
        "...0000000000000000000..",
        "...0111.2222.3333.444.0.",
        "...0111.2222.3333.444.0.",
        "...0000000000000000000..",
        ".....7.....7.....7......",
        "....7.....7.....7.......",
        "...7.....7.....7........",
        "........................",
      ].join(""),
    },
  },
  tiles: {
    label: "지형 타일셋 (8×8 ×4)",
    data: {
      w: 32, h: 8, cell: 14, grid: true,
      palette: [{ c: "#4ade80", name: "잔디" }, { c: "#8b5a2b", name: "흙" }, { c: "#6b7280", name: "돌" }, { c: "#374151", name: "어두운 돌" }, { c: "#fbbf24", name: "광석" }, { c: "#60a5fa", name: "물" }],
      px: "".padEnd(256, "."),
    },
  },
};

export const PIXEL_DEFAULT = PIXELART_PRESETS.fortress.data;

function floodFill(px: string[], w: number, h: number, x: number, y: number, to: string) {
  const from = px[y * w + x];
  if (from === to) return px;
  const out = [...px], stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h || out[cy * w + cx] !== from) continue;
    out[cy * w + cx] = to;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return out;
}

export function PixelArtView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, PIXEL_DEFAULT);
  const [tool, setTool] = useState<"pen" | "erase" | "fill" | "pick">("pen");
  const [color, setColor] = useState(0);
  const [stroke, setStroke] = useState<string[] | null>(null); // local pixels while drawing
  const [edit, setEdit] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const editing = editable && edit;
  const pixels = stroke ?? d.px.padEnd(d.w * d.h, ".").slice(0, d.w * d.h).split("");

  const paint = useCallback(() => {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const s = d.cell;
    g.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      const ch = pixels[y * d.w + x];
      const i = CHARS.indexOf(ch);
      if (i < 0 || !d.palette[i]) continue;
      g.fillStyle = d.palette[i].c;
      g.fillRect(x * s, y * s, s, s);
    }
    if (d.grid && s >= 6) {
      g.strokeStyle = "rgba(127,127,127,.25)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= d.w; x++) { g.moveTo(x * s + 0.5, 0); g.lineTo(x * s + 0.5, d.h * s); }
      for (let y = 0; y <= d.h; y++) { g.moveTo(0, y * s + 0.5); g.lineTo(d.w * s, y * s + 0.5); }
      g.stroke();
    }
  }, [d, pixels]);
  useEffect(paint, [paint]);

  const cellAt = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * d.w), Math.floor(((e.clientY - r.top) / r.height) * d.h)];
  };
  const apply = (e: React.PointerEvent, base: string[]) => {
    const [x, y] = cellAt(e);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return base;
    if (tool === "pick") { const i = CHARS.indexOf(base[y * d.w + x]); if (i >= 0) { setColor(i); setTool("pen"); } return base; }
    if (tool === "fill") return floodFill(base, d.w, d.h, x, y, CHARS[color]);
    const next = [...base];
    next[y * d.w + x] = tool === "erase" ? "." : CHARS[color];
    return next;
  };
  const commit = (px: string[]) => set({ ...d, px: px.join("") });

  const counts = d.palette.map((_, i) => pixels.filter((p) => p === CHARS[i]).length);
  const exportPng = () => {
    const c = document.createElement("canvas");
    c.width = d.w; c.height = d.h;
    const g = c.getContext("2d")!;
    pixels.forEach((ch, k) => { const i = CHARS.indexOf(ch); if (i >= 0 && d.palette[i]) { g.fillStyle = d.palette[i].c; g.fillRect(k % d.w, Math.floor(k / d.w), 1, 1); } });
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `pixel-${d.w}x${d.h}.png`;
    a.click();
  };
  const resize = (w: number, h: number) => {
    w = Math.max(1, Math.min(128, w)); h = Math.max(1, Math.min(128, h));
    const next: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) next.push(y < d.h && x < d.w ? pixels[y * d.w + x] : ".");
    set({ ...d, w, h, px: next.join("") });
  };

  return (
    <Shell icon="🧱" title="픽셀 아트 · 배치도" actions={
      <>
        <Btn title="PNG로 저장" onClick={exportPng}><Download size={13} /></Btn>
        {editable && <Btn active={edit} onClick={() => setEdit((v) => !v)}>{edit ? "완료" : "그리기"}</Btn>}
      </>
    }>
      {editing && (
        <div className="nb-row mb-2">
          <Btn active={tool === "pen"} title="펜" onClick={() => setTool("pen")}><Pencil size={13} /></Btn>
          <Btn active={tool === "erase"} title="지우개" onClick={() => setTool("erase")}><Eraser size={13} /></Btn>
          <Btn active={tool === "fill"} title="채우기" onClick={() => setTool("fill")}><PaintBucket size={13} /></Btn>
          <Btn active={tool === "pick"} title="스포이드" onClick={() => setTool("pick")}><Pipette size={13} /></Btn>
          <span className="nb-label">크기</span>
          <input className="nb-field w-12" type="number" defaultValue={d.w} onBlur={(e) => resize(+e.target.value || d.w, d.h)} />×
          <input className="nb-field w-12" type="number" defaultValue={d.h} onBlur={(e) => resize(d.w, +e.target.value || d.h)} />
          <span className="nb-label">칸</span>
          <input type="range" min={4} max={32} value={d.cell} onChange={(e) => set({ ...d, cell: +e.target.value })} />
          <label className="nb-label"><input type="checkbox" checked={d.grid} onChange={(e) => set({ ...d, grid: e.target.checked })} /> 격자</label>
          <select className="nb-field w-auto" value="" onChange={(e) => {
            const p = PIXELART_PRESETS[e.target.value];
            if (p && confirm(`'${p.label}' 템플릿으로 바꿀까요? 지금 그림은 사라져요 (버전 기록에는 남아요).`)) set(p.data);
          }}>
            <option value="">템플릿…</option>
            {Object.entries(PIXELART_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <div className="nb-art nb-checker">
          <canvas
            ref={cv}
            width={d.w * d.cell}
            height={d.h * d.cell}
            style={{ maxWidth: "100%", touchAction: editing ? "none" : undefined, cursor: editing ? "crosshair" : undefined }}
            onPointerDown={(e) => {
              if (!editing) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const next = apply(e, pixels);
              if (tool === "fill" || tool === "pick") { if (tool === "fill") commit(next); return; }
              setStroke(next);
            }}
            onPointerMove={(e) => { if (stroke) setStroke(apply(e, stroke)); }}
            onPointerUp={() => { if (stroke) { commit(stroke); setStroke(null); } }}
          />
        </div>
        <div className="min-w-[180px] flex-1 space-y-0.5">
          <div className="text-xs font-semibold text-muted">범례</div>
          {d.palette.map((p, i) => (
            <div key={i} className={`flex items-center gap-2 rounded px-1 py-0.5 text-sm ${editing && color === i ? "bg-hover" : ""}`}>
              <button type="button" onClick={() => { setColor(i); if (tool === "erase" || tool === "pick") setTool("pen"); }}
                className={`h-4 w-4 shrink-0 rounded-sm border ${editing && color === i ? "ring-2 ring-accent" : "border-line"}`} style={{ background: p.c }} />
              {editing ? (
                <>
                  <input type="color" value={p.c} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                    onChange={(e) => set({ ...d, palette: d.palette.map((q, j) => (j === i ? { ...q, c: e.target.value } : q)) })} />
                  <Field value={p.name} placeholder="이름" className="min-w-0 flex-1" onCommit={(v) => set({ ...d, palette: d.palette.map((q, j) => (j === i ? { ...q, name: v } : q)) })} />
                </>
              ) : (
                <span className="flex-1 truncate">{p.name || p.c}</span>
              )}
              <span className="text-xs tabular-nums text-muted">{counts[i]}칸</span>
            </div>
          ))}
          {editing && d.palette.length < CHARS.length && (
            <Btn onClick={() => set({ ...d, palette: [...d.palette, { c: "#ffffff", name: "" }] })}><Plus size={12} /> 색 추가</Btn>
          )}
        </div>
      </div>
    </Shell>
  );
}
