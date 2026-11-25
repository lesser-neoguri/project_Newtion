"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ListTree } from "lucide-react";
import { Popover } from "./ui";
import type { BlockNoteEditor } from "./editor";

export interface TocItem { id: string; level: number; text: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inlineText = (content: any): string =>
  Array.isArray(content)
    ? content.map((c) => (c.type === "text" ? c.text : c.type === "link" ? inlineText(c.content) : "")).join("")
    : "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collect(blocks: any[], out: TocItem[]) {
  for (const b of blocks) {
    if (b.type === "heading") {
      const text = inlineText(b.content).trim();
      if (text) out.push({ id: b.id, level: Number(b.props?.level ?? 1), text });
    }
    if (b.children?.length) collect(b.children, out);
  }
  return out;
}

/** Headings of the document, kept up to date as people edit. */
export function useToc(editor: BlockNoteEditor | null) {
  const [items, setItems] = useState<TocItem[]>([]);
  useEffect(() => {
    if (!editor) { setItems([]); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const next = collect(editor.document, []);
        setItems((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      }, 150);
    };
    update();
    const off = editor.onChange(update);
    return () => { clearTimeout(t); off?.(); };
  }, [editor]);
  return items;
}

function headingEl(id: string) {
  return document.querySelector<HTMLElement>(`.bn-editor [data-id="${id}"]`);
}

/** Tracks which heading is at the top of the scroll container. */
function useActive(items: TocItem[], scroller: HTMLElement | null) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!scroller || !items.length) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = scroller.getBoundingClientRect().top + 90;
        let cur: string | null = items[0].id;
        for (const it of items) {
          const el = headingEl(it.id);
          if (el && el.getBoundingClientRect().top <= top) cur = it.id;
        }
        setActive(cur);
      });
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); scroller.removeEventListener("scroll", onScroll); };
  }, [items, scroller]);
  return active;
}

function useJump(scroller: HTMLElement | null) {
  return useCallback((id: string) => {
    const el = headingEl(id);
    if (!el || !scroller) return;
    const y = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
    scroller.scrollTo({ top: y, behavior: "smooth" });
  }, [scroller]);
}

function TocList({ items, active, onJump }: { items: TocItem[]; active: string | null; onJump: (id: string) => void }) {
  const min = Math.min(...items.map((i) => i.level));
  return (
    <nav className="space-y-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onJump(it.id)}
          style={{ paddingLeft: 8 + (it.level - min) * 12 }}
          className={`block w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-hover ${active === it.id ? "font-medium text-accent" : "text-muted"}`}
        >
          {it.text}
        </button>
      ))}
    </nav>
  );
}

/**
 * Wide screens: a quiet column of lines at the right edge of the page that opens into the
 * full outline on hover (Notion style). Rendered inside the scroll container, sticky at the top.
 */
export function TocRail({ items, scroller }: { items: TocItem[]; scroller: HTMLElement | null }) {
  const active = useActive(items, scroller);
  const jump = useJump(scroller);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (items.length < 2) return null;
  const min = Math.min(...items.map((i) => i.level));

  return (
    <div className="pointer-events-none sticky top-0 z-10 hidden h-0 @[1000px]:block">
      <div
        className="pointer-events-auto absolute right-4 top-28"
        onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); }}
        onMouseLeave={() => { closeTimer.current = setTimeout(() => setOpen(false), 150); }}
      >
        {open ? (
          <div className="scrollbar-thin max-h-[60vh] w-60 overflow-y-auto rounded-lg border border-line bg-background p-1.5 shadow-lg">
            <TocList items={items} active={active} onJump={jump} />
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col items-end gap-2.5 overflow-hidden py-2 pl-4">
            {items.map((it) => (
              <span
                key={it.id}
                className={`block h-[3px] rounded-full ${active === it.id ? "bg-foreground/70" : "bg-foreground/15"}`}
                style={{ width: Math.max(8, 20 - (it.level - min) * 5) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Narrower screens and phones: a top-bar button that opens the outline. */
export function TocButton({ items, scroller }: { items: TocItem[]; scroller: HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const active = useActive(open ? items : [], scroller);
  const jump = useJump(scroller);
  if (items.length < 2) return null;
  return (
    <div className="relative @[1000px]:hidden">
      <button title="목차" onClick={() => setOpen(true)} className={`rounded p-1.5 hover:bg-hover ${open ? "bg-hover" : ""}`}>
        <ListTree size={16} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="right">
        <div className="scrollbar-thin max-h-[60vh] w-64 max-w-[80vw] overflow-y-auto p-1">
          <div className="px-2 pb-1 pt-0.5 text-xs font-semibold text-muted">목차</div>
          <TocList items={items} active={active} onJump={(id) => { setOpen(false); jump(id); }} />
        </div>
      </Popover>
    </div>
  );
}
