import { GIFEncoder, applyPalette, quantize } from "gifenc";

export interface FrameSpec {
  /** Frame size in the source image */
  fw: number;
  fh: number;
  /** First frame index (row-major) and how many frames (0 = all) */
  start?: number;
  frames?: number;
  fps: number;
  /** Nearest-neighbour upscale for pixel art */
  scale?: number;
  pingpong?: boolean;
}

/** Cut a sprite sheet into frames: returns the frame source rectangles. */
export function sheetFrames(width: number, height: number, s: FrameSpec) {
  const cols = Math.max(1, Math.floor(width / s.fw)), rows = Math.max(1, Math.floor(height / s.fh));
  const start = s.start ?? 0;
  const total = Math.max(1, Math.min(s.frames || cols * rows - start, cols * rows - start));
  return Array.from({ length: total }, (_, i) => {
    const k = start + i;
    return { sx: (k % cols) * s.fw, sy: Math.floor(k / cols) * s.fh };
  });
}

/**
 * Encode frames into an animated GIF (looping, transparency kept).
 * `draw(ctx, i)` paints frame i onto a canvas of fw*scale × fh*scale.
 */
export function encodeGif(count: number, fw: number, fh: number, fps: number, scale: number, draw: (ctx: CanvasRenderingContext2D, i: number) => void, pingpong = false): Blob {
  const w = Math.max(1, Math.round(fw * scale)), h = Math.max(1, Math.round(fh * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;

  const order = Array.from({ length: count }, (_, i) => i);
  if (pingpong && count > 2) order.push(...order.slice(1, -1).reverse());

  // One palette for the whole animation, so colours don't flicker between frames.
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < count; i++) {
    ctx.clearRect(0, 0, w, h);
    draw(ctx, i);
    frames.push(ctx.getImageData(0, 0, w, h).data);
  }
  const all = new Uint8ClampedArray(frames.reduce((n, f) => n + f.length, 0));
  frames.reduce((o, f) => { all.set(f, o); return o + f.length; }, 0);
  const palette = quantize(all, 256, { format: "rgba4444", oneBitAlpha: true });
  const transparentIndex = palette.findIndex((p) => p[3] === 0);

  const gif = GIFEncoder();
  const delay = Math.max(20, Math.round(1000 / Math.max(1, fps)));
  for (const i of order) {
    const index = applyPalette(frames[i], palette, "rgba4444");
    gif.writeFrame(index, w, h, {
      palette, delay, repeat: 0, dispose: 2,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}

/** Sprite sheet image → GIF. */
export function sheetToGif(img: CanvasImageSource & { width: number; height: number }, s: FrameSpec): Blob {
  const rects = sheetFrames(img.width, img.height, s);
  const scale = s.scale ?? 1;
  return encodeGif(rects.length, s.fw, s.fh, s.fps, scale, (ctx, i) => {
    ctx.drawImage(img, rects[i].sx, rects[i].sy, s.fw, s.fh, 0, 0, s.fw * scale, s.fh * scale);
  }, s.pingpong);
}

/** Separate frame images (same size) → GIF. */
export function framesToGif(imgs: (CanvasImageSource & { width: number; height: number })[], fps: number, scale = 1, pingpong = false): Blob {
  const fw = Math.max(...imgs.map((i) => i.width)), fh = Math.max(...imgs.map((i) => i.height));
  return encodeGif(imgs.length, fw, fh, fps, scale, (ctx, i) => {
    ctx.drawImage(imgs[i], 0, 0, imgs[i].width * scale, imgs[i].height * scale);
  }, pingpong);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("이미지를 불러오지 못했어요"));
    i.src = src;
  });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
