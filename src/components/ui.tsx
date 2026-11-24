"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { OPTION_COLORS, type OptionColor, type Profile } from "@/lib/types";

export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onOutside();
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [ref, onOutside, active]);
}

export function Popover({
  open,
  onClose,
  children,
  className = "",
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, open);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute top-full z-50 mt-1 min-w-48 rounded-lg border border-line bg-background p-1 shadow-xl ${
        align === "right" ? "right-0" : "left-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover ${
        danger ? "text-red-500" : ""
      }`}
    >
      {children}
    </button>
  );
}

export function Modal({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[10vh]">
      <div
        ref={ref}
        className={`max-h-[80vh] w-full overflow-hidden rounded-xl border border-line bg-background shadow-2xl ${
          wide ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Avatar({ profile, size = 24, ring }: { profile?: Pick<Profile, "display_name" | "avatar_color" | "email">; size?: number; ring?: boolean }) {
  const name = profile?.display_name || profile?.email || "?";
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${ring ? "ring-2 ring-background" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.45, background: profile?.avatar_color ?? "#999" }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Tag({ name, color }: { name: string; color: OptionColor }) {
  return (
    <span className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs leading-4 ${OPTION_COLORS[color]}`}>
      {name}
    </span>
  );
}

const EMOJIS = [
  "📄","📘","📗","📕","📝","📌","📎","🗂️","🗃️","📊","📈","🗓️","✅","💡","🔥","⭐",
  "🎮","🕹️","👾","🎲","🧩","🗺️","🏰","⚔️","🛡️","🏹","🔮","🧙","🐉","👺","🤖","🚀",
  "🎨","🖌️","🎬","🎵","🎧","🔊","🧪","🐞","🛠️","⚙️","💻","🖥️","📱","🌐","🔐","📢",
  "🏃","🎯","🏆","💰","💎","❤️","🌲","🌊","🌋","❄️","☀️","🌙","👥","💬","🪦","🧭",
];

export function EmojiPicker({ onPick, onRemove }: { onPick: (e: string) => void; onRemove?: () => void }) {
  return (
    <div className="w-72 p-1">
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => onPick(e)} className="rounded p-1 text-xl hover:bg-hover">
            {e}
          </button>
        ))}
      </div>
      {onRemove && (
        <button onClick={onRemove} className="mt-1 w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-hover">
          아이콘 제거
        </button>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-muted">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  );
}
