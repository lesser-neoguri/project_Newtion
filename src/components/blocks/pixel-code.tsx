"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, Pause, Play, RotateCcw } from "lucide-react";
import { Btn, Shell, useBlockData, type AnyBlock, type AnyEditor } from "./common";

interface PixelCodeData { w: number; h: number; scale: number; fps: number; code: string }

export const PIXEL_SAMPLES: Record<string, { label: string; w: number; h: number; scale: number; code: string }> = {
  platformer: {
    label: "플랫포머 + 블록 캐기",
    w: 96, h: 64, scale: 5,
    code: `// ←→ / A·D 이동, 스페이스 점프
// 마우스 왼쪽: 블록 캐기, 오른쪽: 돌 놓기
const T = 4, cols = W / T | 0, rows = H / T | 0;
const TILE = [null, '#8b5a2b', '#6b7280', '#4ade80'];
let map = [], p = { x: 20, y: 0, vx: 0, vy: 0, w: 3, h: 6, ground: false };

function setup() {
  for (let y = 0; y < rows; y++) {
    map[y] = [];
    for (let x = 0; x < cols; x++) {
      const top = 8 + Math.round(Math.sin(x * 0.45) * 1.5 + Math.sin(x * 0.13) * 2);
      map[y][x] = y < top ? 0 : y === top ? 3 : y < top + 3 ? 1 : 2;
    }
  }
}

function hit(x, y, w, h) {
  for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - 0.01) / T); ty++)
    for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - 0.01) / T); tx++)
      if (tx < 0 || tx >= cols || ty >= rows || (ty >= 0 && map[ty][tx])) return true;
  return false;
}

function update(dt) {
  p.vx = ((key('right') || key('d')) - (key('left') || key('a'))) * 32;
  if ((key('space') || key('up') || key('w')) && p.ground) p.vy = -60;
  p.vy = Math.min(p.vy + 170 * dt, 120);

  p.x += p.vx * dt;
  if (hit(p.x, p.y, p.w, p.h)) {            // 한 칸짜리 턱은 자동으로 올라가기
    if (!hit(p.x, p.y - T, p.w, p.h) && p.ground) p.y -= T; else p.x -= p.vx * dt;
  }
  p.y += p.vy * dt; p.ground = false;
  if (hit(p.x, p.y, p.w, p.h)) {
    if (p.vy > 0) { p.y = Math.floor((p.y + p.h) / T) * T - p.h; p.ground = true; }
    else p.y = Math.ceil(p.y / T) * T;
    p.vy = 0;
  }
  if (mouse.down) {
    const tx = mouse.x / T | 0, ty = mouse.y / T | 0;
    if (map[ty] && tx >= 0 && tx < cols) map[ty][tx] = mouse.right ? 2 : 0;
  }
}

function draw() {
  clear('#7dd3fc');
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const t = map[y][x];
    if (!t) continue;
    rect(x * T, y * T, T, T, TILE[t]);
    px(x * T, y * T, '#00000033');              // 타일 테두리 느낌
  }
  const x = p.x | 0, y = p.y | 0;
  rect(x, y, 3, 6, '#fcd34d');                  // 몸
  rect(x, y, 3, 2, '#7c2d12');                  // 머리카락
  px(x + (p.vx < 0 ? 0 : 2), y + 2, '#111827'); // 눈
}`,
  },
  sand: {
    label: "모래·물 시뮬레이션",
    w: 96, h: 64, scale: 5,
    code: `// 마우스로 그리기 · 1 모래 2 물 3 돌 4 지우개
const C = ['#0b1020', '#e9c46a', '#3b82f6', '#6b7280'];
let g = new Uint8Array(W * H), brush = 1;

function setup() {
  for (let x = 0; x < W; x++) g[(H - 1) * W + x] = 3;
  for (let x = 20; x < 50; x++) g[40 * W + x] = 3;
}

function update() {
  if (key('1')) brush = 1; if (key('2')) brush = 2; if (key('3')) brush = 3; if (key('4')) brush = 0;
  if (mouse.down) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = mouse.x + dx | 0, y = mouse.y + dy | 0;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    if (brush === 0 || brush === 3 || Math.random() < 0.6) g[y * W + x] = brush;
  }
  for (let y = H - 2; y >= 0; y--) {
    for (let i = 0; i < W; i++) {
      const x = frame & 1 ? i : W - 1 - i, at = y * W + x, c = g[at];
      if (c !== 1 && c !== 2) continue;
      const swap = (to) => { const t = g[to]; if (t === 0 || (c === 1 && t === 2)) { g[to] = c; g[at] = t; return true; } return false; };
      const d = Math.random() < 0.5 ? -1 : 1, below = at + W;
      if (swap(below)) continue;
      if (x + d >= 0 && x + d < W && swap(below + d)) continue;
      if (x - d >= 0 && x - d < W && swap(below - d)) continue;
      if (c === 2 && x + d >= 0 && x + d < W && g[at + d] === 0) { g[at + d] = 2; g[at] = 0; }
    }
  }
}

function draw() {
  for (let i = 0; i < W * H; i++) px(i % W, i / W | 0, C[g[i]]);
}`,
  },
  fortress: {
    label: "걷는 이동 성채",
    w: 96, h: 64, scale: 5,
    code: `// ←/→ 속도 조절
let speed = 20, dist = 0, smoke = [];

function update(dt) {
  if (key('right')) speed = Math.min(60, speed + 30 * dt);
  if (key('left')) speed = Math.max(0, speed - 30 * dt);
  dist += speed * dt;
  if (Math.random() < 0.35) smoke.push({ x: 51, y: 12, vx: -speed * 0.4 - 3, vy: -7, life: 1.6 });
  for (const s of smoke) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
  smoke = smoke.filter((s) => s.life > 0);
}

function draw() {
  clear('#fde68a');
  for (let x = 0; x < W; x++) line(x, 34 + Math.sin((x + dist * 0.3) * 0.08) * 4, x, H, '#f59e0b');
  for (let x = 0; x < W; x++) line(x, 52 + Math.sin((x + dist) * 0.15) * 1.5, x, H, '#78350f');

  const bob = Math.sin(dist * 0.25) * 1.2;
  for (let i = 0; i < 4; i++) {                     // 다리 4개
    const lx = 30 + i * 9, ph = dist * 0.25 + i * Math.PI / 2;
    const fx = lx + Math.cos(ph) * 3, fy = 52 - Math.max(0, Math.sin(ph)) * 3;
    line(lx, 39 + bob, fx, fy, '#374151'); line(lx + 1, 39 + bob, fx + 1, fy, '#374151');
  }
  const by = 26 + bob | 0;
  rect(26, by, 40, 14, '#6b7280');                  // 하부 갑판
  rect(28, by - 8, 12, 8, '#b91c1c');               // 거주 모듈
  rect(42, by - 10, 10, 10, '#2563eb');             // 창고 모듈
  rect(56, by - 6, 6, 6, '#374151');                // 포탑
  line(59, by - 5, 66, by - 9, '#111827');
  rect(50, by - 14, 3, 6, '#1f2937');               // 굴뚝
  for (let x = 29; x < 64; x += 4) px(x, by + 4, '#fbbf24');
  for (const s of smoke) rect(s.x | 0, s.y + bob | 0, 2, 2, s.life > 0.9 ? '#9ca3af' : '#e5e7eb');
}`,
  },
};

export const PIXELCODE_DEFAULT: PixelCodeData = { w: 96, h: 64, scale: 5, fps: 30, code: PIXEL_SAMPLES.platformer.code };

function runtime(d: PixelCodeData) {
  const code = JSON.stringify(d.code).replace(/<\//g, "<\\/");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:crosshair}
canvas{display:block;width:100%;height:100%;image-rendering:pixelated}
#hint{position:fixed;inset:auto 0 4px 0;text-align:center;font:11px sans-serif;color:#fff8;pointer-events:none}
#pad{position:fixed;inset:auto 0 6px 0;display:none;justify-content:space-between;padding:0 8px;pointer-events:none}
#pad div{display:flex;gap:6px}
#pad button{pointer-events:auto;width:40px;height:40px;border-radius:999px;border:0;background:#fff3;color:#fff;font:16px sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
#pad button:active{background:#fff6}
</style></head><body><canvas id="c"></canvas><div id="hint">클릭하면 키보드로 조작할 수 있어요</div><div id="pad"><div><button data-k="left">◀</button><button data-k="right">▶</button></div><div><button data-k="down">▼</button><button data-k="space">⤒</button></div></div><script>
const W=${d.w|0},H=${d.h|0},FPS=${Math.max(1, Math.min(60, d.fps|0))};
const cv=document.getElementById('c');cv.width=W;cv.height=H;const ctx=cv.getContext('2d');
const img=ctx.createImageData(W,H);const buf=new Uint32Array(img.data.buffer);
const PAL=['#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f','#c2c3c7','#fff1e8','#ff004d','#ffa300','#ffec27','#00e436','#29adff','#83769c','#ff77a8','#ffccaa'];
const cache=new Map();
function col(c){if(typeof c==='number')c=PAL[((c|0)%16+16)%16];let v=cache.get(c);if(v!==undefined)return v;
 let s=String(c).replace('#','');if(s.length===3||s.length===4)s=[...s].map(x=>x+x).join('');
 const r=parseInt(s.slice(0,2),16)||0,g=parseInt(s.slice(2,4),16)||0,b=parseInt(s.slice(4,6),16)||0,a=s.length>=8?parseInt(s.slice(6,8),16):255;
 v=((a<<24)|(b<<16)|(g<<8)|r)>>>0;cache.set(c,v);return v}
function px(x,y,c){x|=0;y|=0;if(x<0||y<0||x>=W||y>=H)return;const v=col(c),a=v>>>24;const i=y*W+x;
 if(a===255){buf[i]=v;return}if(a===0)return;const o=buf[i],k=a/255;
 const r=(o&255)*(1-k)+(v&255)*k,g=((o>>8)&255)*(1-k)+((v>>8)&255)*k,b=((o>>16)&255)*(1-k)+((v>>16)&255)*k;
 buf[i]=((255<<24)|(b<<16)|(g<<8)|r)>>>0}
function clear(c){buf.fill(col(c===undefined?0:c))}
function rect(x,y,w,h,c){for(let j=0;j<h;j++)for(let i=0;i<w;i++)px(x+i,y+j,c)}
function line(x0,y0,x1,y1,c){x0|=0;y0|=0;x1|=0;y1|=0;const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let e=dx+dy;
 for(;;){px(x0,y0,c);if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx}if(e2<=dx){e+=dx;y0+=sy}}}
function circ(cx,cy,r,c,fill){for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++){const d=x*x+y*y;if(fill?d<=r*r:Math.abs(Math.sqrt(d)-r)<0.5)px(cx+x,cy+y,c)}}
function rnd(n){return Math.random()*(n===undefined?1:n)}
const keys=new Set();const mouse={x:0,y:0,down:false,right:false};
const name=k=>({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',' ':'space',Enter:'enter',Shift:'shift',Escape:'escape'}[k]||k.toLowerCase());
addEventListener('keydown',e=>{keys.add(name(e.key));if(e.key.startsWith('Arrow')||e.key===' ')e.preventDefault()});
addEventListener('keyup',e=>keys.delete(name(e.key)));
addEventListener('blur',()=>keys.clear());
function key(k){return keys.has(k)}
if(matchMedia('(pointer: coarse)').matches){const pad=document.getElementById('pad');pad.style.display='flex';document.getElementById('hint').textContent='';
 pad.querySelectorAll('button').forEach(b=>{const k=b.dataset.k;b.addEventListener('pointerdown',e=>{e.preventDefault();keys.add(k);if(k==='space')keys.add('up')});
 const up=()=>{keys.delete(k);if(k==='space')keys.delete('up')};b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('pointerleave',up)})}
const pos=e=>{const r=cv.getBoundingClientRect();mouse.x=Math.floor((e.clientX-r.left)/r.width*W);mouse.y=Math.floor((e.clientY-r.top)/r.height*H)};
cv.addEventListener('pointerdown',e=>{pos(e);mouse.down=true;mouse.right=e.button===2;document.getElementById('hint').remove?.();cv.setPointerCapture(e.pointerId)});
cv.addEventListener('pointermove',pos);cv.addEventListener('pointerup',()=>{mouse.down=false});
cv.addEventListener('contextmenu',e=>e.preventDefault());
const report=m=>parent.postMessage({type:'pixel',error:String(m)},'*');
let frame=0,t=0,paused=false,fn={};
addEventListener('message',e=>{if(e.data&&e.data.type==='pause')paused=e.data.value});
try{fn=new Function('W','H','px','clear','rect','line','circ','rnd','key','mouse','PAL',
 ${code}+';\\nreturn {setup:typeof setup==="function"?setup:null,update:typeof update==="function"?update:null,draw:typeof draw==="function"?draw:null}')
 (W,H,px,clear,rect,line,circ,rnd,key,mouse,PAL);
 Object.defineProperty(window,'frame',{get:()=>frame});Object.defineProperty(window,'t',{get:()=>t});
 fn.setup&&fn.setup();parent.postMessage({type:'pixel',ok:true},'*')}catch(e){report(e&&e.message||e)}
let last=performance.now(),acc=0;const step=1/FPS;
function loop(now){requestAnimationFrame(loop);if(paused){last=now;return}acc+=Math.min(0.25,(now-last)/1000);last=now;
 if(acc<step)return;try{while(acc>=step){fn.update&&fn.update(step);t+=step;frame++;acc-=step}fn.draw&&fn.draw();ctx.putImageData(img,0,0)}catch(e){report(e&&e.message||e);paused=true}}
requestAnimationFrame(loop);
</script></body></html>`;
}

export function PixelCodeView({ block, editor }: { block: AnyBlock; editor: AnyEditor }) {
  const [d, set, editable] = useBlockData(block, editor, PIXELCODE_DEFAULT);
  const [showCode, setShowCode] = useState(false);
  const [draft, setDraft] = useState(d.code);
  const [runKey, setRunKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => runtime(d), [d, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setDraft(d.code); }, [d.code]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== "pixel") return;
      setError(e.data.error ?? null);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  useEffect(() => { setPaused(false); setError(null); }, [srcDoc]);

  const apply = (patch: Partial<PixelCodeData> = {}) => {
    set({ ...d, code: draft, ...patch });
    setRunKey((k) => k + 1);
  };

  return (
    <Shell icon="👾" title="픽셀 코드" actions={
      <>
        <Btn title={paused ? "재생" : "일시정지"} onClick={() => { frame.current?.contentWindow?.postMessage({ type: "pause", value: !paused }, "*"); setPaused((v) => !v); }}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
        </Btn>
        <Btn title="처음부터" onClick={() => setRunKey((k) => k + 1)}><RotateCcw size={13} /></Btn>
        <Btn active={showCode} onClick={() => setShowCode((v) => !v)}><Code2 size={13} /> 코드</Btn>
      </>
    }>
      <div className="nb-stage">
        <iframe
          key={runKey}
          ref={frame}
          title="픽셀 코드 실행"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ width: d.w * d.scale, aspectRatio: `${d.w} / ${d.h}` }}
          className="nb-pixel-frame"
        />
      </div>
      {error && <p className="nb-error">⚠️ {error}</p>}
      {showCode && (
        <div className="mt-2 space-y-1.5">
          {editable && (
            <div className="nb-row">
              <select className="nb-field w-auto" value="" onChange={(e) => {
                const s = PIXEL_SAMPLES[e.target.value];
                if (!s) return;
                if (draft !== d.code || confirm("예제로 바꿀까요? 지금 코드는 사라져요 (버전 기록에는 남아요).")) {
                  setDraft(s.code);
                  set({ ...d, code: s.code, w: s.w, h: s.h, scale: s.scale });
                  setRunKey((k) => k + 1);
                }
              }}>
                <option value="">예제 불러오기…</option>
                {Object.entries(PIXEL_SAMPLES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
              <label className="nb-label">크기
                <input className="nb-field w-14" type="number" min={8} max={320} defaultValue={d.w} onBlur={(e) => apply({ w: Math.max(8, Math.min(320, +e.target.value || 64)) })} />×
                <input className="nb-field w-14" type="number" min={8} max={240} defaultValue={d.h} onBlur={(e) => apply({ h: Math.max(8, Math.min(240, +e.target.value || 48)) })} />
              </label>
              <label className="nb-label">배율 <input className="nb-field w-12" type="number" min={1} max={12} defaultValue={d.scale} onBlur={(e) => apply({ scale: Math.max(1, Math.min(12, +e.target.value || 4)) })} /></label>
              <label className="nb-label">FPS <input className="nb-field w-12" type="number" min={1} max={60} defaultValue={d.fps} onBlur={(e) => apply({ fps: Math.max(1, Math.min(60, +e.target.value || 30)) })} /></label>
            </div>
          )}
          <textarea
            className="nb-code"
            spellCheck={false}
            readOnly={!editable}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget, s = el.selectionStart, en = el.selectionEnd;
                setDraft(draft.slice(0, s) + "  " + draft.slice(en));
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply(); }
            }}
            rows={Math.min(24, draft.split("\n").length + 1)}
          />
          {editable && (
            <div className="nb-row">
              <Btn onClick={() => apply()} disabled={draft === d.code}><Play size={12} /> 저장하고 실행 (Ctrl+Enter)</Btn>
              <span className="text-xs text-muted">API: px · rect · line · circ · clear · key(&apos;left&apos;) · mouse · rnd · W · H · frame · t · PAL(0~15)</span>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
