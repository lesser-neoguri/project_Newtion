/** Server-side (Node) sprite sheet PNG → animated GIF, for MCP tools. No canvas needed. */
import { PNG } from "pngjs";
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export interface SheetSpec { fw?: number; fh?: number; start?: number; frames?: number; fps?: number; scale?: number; pingpong?: boolean }

export function pngSheetToGif(png: Buffer, s: SheetSpec): { gif: Uint8Array; width: number; height: number; frames: number } {
  const img = PNG.sync.read(png);
  const fh = Math.max(1, s.fh || img.height);
  const fw = Math.max(1, s.fw || (img.width % fh === 0 ? fh : img.width));
  const cols = Math.max(1, Math.floor(img.width / fw)), rows = Math.max(1, Math.floor(img.height / fh));
  const start = Math.max(0, s.start ?? 0);
  const total = Math.max(1, Math.min(s.frames || cols * rows - start, cols * rows - start));
  const scale = Math.max(1, Math.min(8, Math.round(s.scale ?? 1)));
  const w = fw * scale, h = fh * scale;

  const frames: Uint8ClampedArray[] = [];
  for (let n = 0; n < total; n++) {
    const k = start + n, sx = (k % cols) * fw, sy = Math.floor(k / cols) * fh;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((sy + Math.floor(y / scale)) * img.width + sx + Math.floor(x / scale)) * 4;
      out.set(img.data.subarray(si, si + 4), (y * w + x) * 4);
    }
    frames.push(out);
  }
  const all = new Uint8ClampedArray(frames.length * w * h * 4);
  frames.forEach((f, i) => all.set(f, i * f.length));
  const palette = quantize(all, 256, { format: "rgba4444", oneBitAlpha: true });
  const transparentIndex = palette.findIndex((p) => p[3] === 0);
  const order = frames.map((_, i) => i);
  if (s.pingpong && frames.length > 2) order.push(...order.slice(1, -1).reverse());

  const enc = GIFEncoder();
  const delay = Math.max(20, Math.round(1000 / Math.max(1, s.fps ?? 10)));
  for (const i of order) {
    enc.writeFrame(applyPalette(frames[i], palette, "rgba4444"), w, h, {
      palette, delay, repeat: 0, dispose: 2, ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
  }
  enc.finish();
  return { gif: enc.bytes(), width: w, height: h, frames: total };
}

/** Width/height from a GIF header. */
export function gifSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 10 || String.fromCharCode(...buf.subarray(0, 3)) !== "GIF") return null;
  return { width: buf[6] | (buf[7] << 8), height: buf[8] | (buf[9] << 8) };
}
