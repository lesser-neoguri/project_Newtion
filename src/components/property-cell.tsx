"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Avatar, Popover, Tag } from "./ui";
import {
  uid, type DbProperty, type Member, type OptionColor, type PropOption, type PropValue,
} from "@/lib/types";

const COLORS: OptionColor[] = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export function PropertyCell({
  prop, value, onChange, members, canEdit, onAddOption, compact,
}: {
  prop: DbProperty;
  value: PropValue | undefined;
  onChange: (v: PropValue) => void;
  members: Member[];
  canEdit: boolean;
  onAddOption: (propId: string, opt: PropOption) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const base = `w-full min-h-8 px-2 py-1.5 text-sm ${canEdit ? "cursor-pointer hover:bg-hover" : ""} rounded`;

  switch (prop.type) {
    case "checkbox":
      return (
        <div className={base}>
          <input type="checkbox" disabled={!canEdit} checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        </div>
      );
    case "text":
    case "url":
    case "number":
      return <TextCell prop={prop} value={value} onChange={onChange} canEdit={canEdit} className={base} />;
    case "date":
      return (
        <input
          type="date"
          disabled={!canEdit}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className={`${base} bg-transparent outline-none`}
        />
      );
    case "person": {
      const m = members.find((x) => x.user_id === value);
      return (
        <div className="relative">
          <div className={base} onClick={() => canEdit && setOpen(true)}>
            {m ? (
              <span className="flex items-center gap-1.5">
                <Avatar profile={m.profile} size={20} />
                {!compact && <span className="truncate">{m.profile.display_name}</span>}
              </span>
            ) : (
              <span className="text-muted">{compact ? "" : "비어 있음"}</span>
            )}
          </div>
          <Popover open={open} onClose={() => setOpen(false)}>
            {members.map((mm) => (
              <button key={mm.user_id} onClick={() => { onChange(mm.user_id); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover">
                <Avatar profile={mm.profile} size={20} /> {mm.profile.display_name}
              </button>
            ))}
            {value && (
              <button onClick={() => { onChange(null); setOpen(false); }} className="w-full rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-hover">
                지우기
              </button>
            )}
          </Popover>
        </div>
      );
    }
    case "select":
    case "status":
    case "multi_select": {
      const multi = prop.type === "multi_select";
      const selected: string[] = multi ? ((value as string[]) ?? []) : value ? [value as string] : [];
      const opts = prop.options ?? [];
      return (
        <div className="relative">
          <div className={`${base} flex flex-wrap gap-1`} onClick={() => canEdit && setOpen(true)}>
            {selected.map((id) => {
              const o = opts.find((x) => x.id === id);
              return o ? <Tag key={id} name={o.name} color={o.color} /> : null;
            })}
            {selected.length === 0 && !compact && <span className="text-muted">비어 있음</span>}
          </div>
          <OptionPicker
            open={open}
            onClose={() => setOpen(false)}
            options={opts}
            selected={selected}
            onToggle={(id) => {
              if (multi) {
                onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
              } else {
                onChange(selected[0] === id ? null : id);
                setOpen(false);
              }
            }}
            onCreate={(name) => {
              const opt: PropOption = { id: uid("o"), name, color: COLORS[opts.length % COLORS.length] };
              onAddOption(prop.id, opt);
              onChange(multi ? [...selected, opt.id] : opt.id);
              if (!multi) setOpen(false);
            }}
          />
        </div>
      );
    }
  }
}

function TextCell({ prop, value, onChange, canEdit, className }: {
  prop: DbProperty; value: PropValue | undefined; onChange: (v: PropValue) => void; canEdit: boolean; className: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const v = prop.type === "number" ? (draft === "" ? null : Number(draft)) : draft || null;
    if (v !== value) onChange(v);
  };
  if (prop.type === "url" && !canEdit && value) {
    return <a href={String(value)} target="_blank" rel="noreferrer" className={`${className} block truncate text-accent underline`}>{String(value)}</a>;
  }
  return (
    <input
      disabled={!canEdit}
      type={prop.type === "number" ? "number" : "text"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder=""
      className={`${className} bg-transparent outline-none ${prop.type === "url" && draft ? "text-accent underline" : ""} ${prop.type === "number" ? "text-right" : ""}`}
    />
  );
}

function OptionPicker({ open, onClose, options, selected, onToggle, onCreate }: {
  open: boolean; onClose: () => void; options: PropOption[]; selected: string[];
  onToggle: (id: string) => void; onCreate: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const exact = options.some((o) => o.name === q.trim());
  return (
    <Popover open={open} onClose={() => { setQ(""); onClose(); }} className="w-60">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) {
            if (filtered[0] && !(!exact && filtered.length === 0)) onToggle(filtered[0].id);
            else onCreate(q.trim());
            setQ("");
          }
        }}
        placeholder="옵션 검색 또는 생성"
        className="mb-1 w-full rounded border border-line bg-transparent px-2 py-1 text-sm outline-none"
      />
      <div className="max-h-60 overflow-y-auto">
        {filtered.map((o) => (
          <button key={o.id} onClick={() => onToggle(o.id)} className="flex w-full items-center justify-between rounded px-2 py-1 hover:bg-hover">
            <Tag name={o.name} color={o.color} />
            {selected.includes(o.id) && <X size={12} className="text-muted" />}
          </button>
        ))}
        {q.trim() && !exact && (
          <button onClick={() => { onCreate(q.trim()); setQ(""); }} className="flex w-full items-center gap-1 rounded px-2 py-1 text-sm hover:bg-hover">
            <Plus size={12} /> 생성: <b>{q.trim()}</b>
          </button>
        )}
      </div>
    </Popover>
  );
}
