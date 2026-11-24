"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText, KanbanSquare, MoreHorizontal, Plus, Search, Table2, Trash2, Type,
} from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { PropertyCell } from "./property-cell";
import { MenuItem, Popover, Tag } from "./ui";
import { createPage, setArchived } from "@/lib/api";
import {
  PROP_TYPE_LABELS, uid, type DbProperty, type DbSchema, type DbView, type PropOption,
  type PropType, type PropValue,
} from "@/lib/types";

interface Row {
  id: string;
  title: string;
  icon: string | null;
  position: number;
  properties: Record<string, PropValue>;
  archived_at: string | null;
}

export function DatabaseView({
  pageId, schema, onSchemaChange,
}: {
  pageId: string;
  schema: DbSchema;
  onSchemaChange: (s: DbSchema) => void;
}) {
  const { sb, me, workspace, canEdit } = useWorkspace();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewId, setViewId] = useState<string | undefined>(schema.views[0]?.id);
  const [q, setQ] = useState("");
  const [viewMenu, setViewMenu] = useState(false);

  const view: DbView = schema.views.find((v) => v.id === viewId) ?? schema.views[0] ?? { id: "table", name: "표", type: "table" };

  // Load + realtime rows
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await sb
        .from("pages")
        .select("id, title, icon, position, properties, archived_at")
        .eq("parent_id", pageId)
        .eq("kind", "row")
        .is("archived_at", null)
        .order("position");
      if (alive) { setRows((data ?? []) as Row[]); setLoading(false); }
    })();
    const ch = sb
      .channel(`db-rows:${pageId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pages", filter: `parent_id=eq.${pageId}` }, (payload) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id: string }).id;
          setRows((r) => r.filter((x) => x.id !== id));
          return;
        }
        const n = payload.new as Row & { kind: string };
        if (n.kind !== "row") return;
        setRows((prev) => {
          const without = prev.filter((x) => x.id !== n.id);
          if (n.archived_at) return without;
          const row: Row = { id: n.id, title: n.title, icon: n.icon, position: n.position, properties: n.properties ?? {}, archived_at: null };
          return [...without, row].sort((a, b) => a.position - b.position);
        });
      })
      .subscribe();
    return () => { alive = false; void sb.removeChannel(ch); };
  }, [sb, pageId]);

  const updateRow = useCallback(async (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, properties: { ...r.properties, ...(patch.properties ?? {}) } } : r)));
    const { properties, ...rest } = patch;
    if (Object.keys(rest).length) await sb.from("pages").update(rest).eq("id", id);
    for (const [key, value] of Object.entries(properties ?? {})) {
      await sb.rpc("set_row_property", { p_page: id, p_key: key, p_value: value });
    }
  }, [sb]);

  const addRow = useCallback(async (props: Record<string, PropValue> = {}, open = false) => {
    const page = await createPage(sb, {
      workspaceId: workspace.id, userId: me.id, parentId: pageId, kind: "row", properties: props,
    });
    setRows((prev) => prev.some((r) => r.id === page.id) ? prev : [...prev, { id: page.id, title: "", icon: null, position: page.position, properties: props, archived_at: null }]);
    if (open) router.push(`/w/${workspace.id}/p/${page.id}`);
    return page;
  }, [sb, workspace.id, me.id, pageId, router]);

  const addOption = useCallback((propId: string, opt: PropOption) => {
    onSchemaChange({
      ...schema,
      properties: schema.properties.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), opt] } : p)),
    });
  }, [schema, onSchemaChange]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => r.title.toLowerCase().includes(term));
  }, [rows, q]);

  const addView = (type: "table" | "board") => {
    const groupable = schema.properties.find((p) => p.type === "status" || p.type === "select");
    const v: DbView = { id: uid("v"), name: type === "table" ? "표" : "보드", type, groupBy: type === "board" ? groupable?.id : undefined };
    onSchemaChange({ ...schema, views: [...schema.views, v] });
    setViewId(v.id);
    setViewMenu(false);
  };

  return (
    <div className="mt-2">
      {/* Views + toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line pb-1">
        {schema.views.map((v) => (
          <button key={v.id} onClick={() => setViewId(v.id)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm ${v.id === view.id ? "bg-hover font-medium" : "text-muted hover:bg-hover"}`}>
            {v.type === "board" ? <KanbanSquare size={14} /> : <Table2 size={14} />}
            {v.name}
          </button>
        ))}
        {canEdit && (
          <div className="relative">
            <button onClick={() => setViewMenu(true)} className="rounded-md p-1 text-muted hover:bg-hover" title="뷰 추가"><Plus size={14} /></button>
            <Popover open={viewMenu} onClose={() => setViewMenu(false)}>
              <MenuItem onClick={() => addView("table")}><Table2 size={14} /> 표 뷰 추가</MenuItem>
              <MenuItem onClick={() => addView("board")}><KanbanSquare size={14} /> 보드 뷰 추가</MenuItem>
            </Popover>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted focus-within:bg-hover">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" className="w-28 bg-transparent outline-none" />
          </div>
          {canEdit && (
            <ViewSettings schema={schema} view={view} onSchemaChange={onSchemaChange} onDeleted={() => setViewId(schema.views.find((v) => v.id !== view.id)?.id)} />
          )}
          {canEdit && (
            <button onClick={() => addRow({}, true)} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white">새로 만들기</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : view.type === "board" ? (
        <BoardView schema={schema} view={view} rows={filtered} updateRow={updateRow} addRow={addRow} addOption={addOption} />
      ) : (
        <TableView schema={schema} rows={filtered} updateRow={updateRow} addRow={addRow} addOption={addOption} onSchemaChange={onSchemaChange} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function ViewSettings({ schema, view, onSchemaChange, onDeleted }: {
  schema: DbSchema; view: DbView; onSchemaChange: (s: DbSchema) => void; onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const patchView = (patch: Partial<DbView>) =>
    onSchemaChange({ ...schema, views: schema.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  return (
    <div className="relative">
      <button onClick={() => setOpen(true)} className="rounded-md p-1 text-muted hover:bg-hover" title="뷰 설정"><MoreHorizontal size={16} /></button>
      <Popover open={open} onClose={() => setOpen(false)} align="right" className="w-64 p-2">
        <label className="text-xs text-muted">뷰 이름</label>
        <input defaultValue={view.name} onBlur={(e) => e.target.value && patchView({ name: e.target.value })}
          className="mb-2 w-full rounded border border-line bg-transparent px-2 py-1 text-sm outline-none" />
        {view.type === "board" && (
          <>
            <label className="text-xs text-muted">그룹 기준</label>
            <select value={view.groupBy ?? ""} onChange={(e) => patchView({ groupBy: e.target.value })}
              className="mb-2 w-full rounded border border-line bg-background px-2 py-1 text-sm">
              {schema.properties.filter((p) => ["select", "status", "person"].includes(p.type)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}
        {schema.views.length > 1 && (
          <MenuItem danger onClick={() => {
            onSchemaChange({ ...schema, views: schema.views.filter((v) => v.id !== view.id) });
            setOpen(false);
            onDeleted();
          }}>
            <Trash2 size={14} /> 뷰 삭제
          </MenuItem>
        )}
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------
type RowOps = {
  rows: Row[];
  updateRow: (id: string, patch: Partial<Row>) => Promise<void>;
  addRow: (props?: Record<string, PropValue>, open?: boolean) => Promise<unknown>;
  addOption: (propId: string, opt: PropOption) => void;
};

function TableView({ schema, rows, updateRow, addRow, addOption, onSchemaChange }: RowOps & {
  schema: DbSchema; onSchemaChange: (s: DbSchema) => void;
}) {
  const { workspace, members, canEdit, sb } = useWorkspace();
  const [adding, setAdding] = useState(false);

  const addProperty = (type: PropType) => {
    const prop: DbProperty = { id: uid("p"), name: PROP_TYPE_LABELS[type], type, options: ["select", "multi_select", "status"].includes(type) ? [] : undefined };
    onSchemaChange({ ...schema, properties: [...schema.properties, prop] });
    setAdding(false);
  };

  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-max min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="w-72 min-w-72 px-2 py-1.5 font-normal"><span className="flex items-center gap-1"><Type size={14} /> 이름</span></th>
            {schema.properties.map((p) => (
              <th key={p.id} className="min-w-40 border-l border-line font-normal">
                <PropertyHeader prop={p} schema={schema} onSchemaChange={onSchemaChange} canEdit={canEdit} />
              </th>
            ))}
            {canEdit && (
              <th className="relative w-10 border-l border-line">
                <button onClick={() => setAdding(true)} className="p-1.5 hover:bg-hover"><Plus size={14} /></button>
                <Popover open={adding} onClose={() => setAdding(false)} align="right">
                  <div className="px-2 py-1 text-xs text-muted">속성 유형</div>
                  {(Object.keys(PROP_TYPE_LABELS) as PropType[]).map((t) => (
                    <MenuItem key={t} onClick={() => addProperty(t)}>{PROP_TYPE_LABELS[t]}</MenuItem>
                  ))}
                </Popover>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="group border-b border-line">
              <td className="px-1">
                <div className="flex items-center gap-1">
                  <TitleInput value={r.title} canEdit={canEdit} onCommit={(title) => updateRow(r.id, { title })} />
                  <Link href={`/w/${workspace.id}/p/${r.id}`}
                    className="flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs text-muted touch-show opacity-0 hover:bg-hover group-hover:opacity-100">
                    <FileText size={12} /> 열기
                  </Link>
                  {canEdit && (
                    <button title="삭제" onClick={() => void setArchived(sb, r.id, true)} className="shrink-0 rounded p-1 text-muted touch-show opacity-0 hover:bg-hover group-hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </td>
              {schema.properties.map((p) => (
                <td key={p.id} className="border-l border-line">
                  <PropertyCell prop={p} value={r.properties[p.id]} members={members} canEdit={canEdit}
                    onAddOption={addOption}
                    onChange={(v) => updateRow(r.id, { properties: { [p.id]: v } })} />
                </td>
              ))}
              {canEdit && <td className="border-l border-line" />}
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <button onClick={() => addRow()} className="flex w-full items-center gap-1 px-2 py-2 text-sm text-muted hover:bg-hover">
          <Plus size={14} /> 새 항목
        </button>
      )}
      <div className="px-2 py-1 text-xs text-muted">항목 {rows.length}개</div>
    </div>
  );
}

function TitleInput({ value, canEdit, onCommit }: { value: string; canEdit: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      disabled={!canEdit}
      value={draft}
      placeholder="제목 없음"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="min-w-0 flex-1 bg-transparent px-1 py-1.5 font-medium outline-none"
    />
  );
}

function PropertyHeader({ prop, schema, onSchemaChange, canEdit }: {
  prop: DbProperty; schema: DbSchema; onSchemaChange: (s: DbSchema) => void; canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<DbProperty>) =>
    onSchemaChange({ ...schema, properties: schema.properties.map((x) => (x.id === prop.id ? { ...x, ...p } : x)) });
  return (
    <div className="relative">
      <button disabled={!canEdit} onClick={() => setOpen(true)} className="w-full truncate px-2 py-1.5 text-left hover:bg-hover">
        {prop.name}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-60 p-2">
        <input defaultValue={prop.name} onBlur={(e) => e.target.value && patch({ name: e.target.value })}
          className="mb-2 w-full rounded border border-line bg-transparent px-2 py-1 text-sm outline-none" />
        <label className="text-xs text-muted">유형</label>
        <select value={prop.type} onChange={(e) => {
          const type = e.target.value as PropType;
          patch({ type, options: ["select", "multi_select", "status"].includes(type) ? prop.options ?? [] : prop.options });
        }} className="mb-2 w-full rounded border border-line bg-background px-2 py-1 text-sm">
          {(Object.keys(PROP_TYPE_LABELS) as PropType[]).map((t) => <option key={t} value={t}>{PROP_TYPE_LABELS[t]}</option>)}
        </select>
        {prop.options && prop.options.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {prop.options.map((o) => (
              <span key={o.id} className="group/opt inline-flex items-center">
                <Tag name={o.name} color={o.color} />
                <button className="ml-0.5 text-xs text-muted hover:text-red-500" title="옵션 삭제"
                  onClick={() => patch({ options: prop.options!.filter((x) => x.id !== o.id) })}>×</button>
              </span>
            ))}
          </div>
        )}
        <MenuItem danger onClick={() => {
          if (!confirm(`'${prop.name}' 속성을 삭제할까요?`)) return;
          onSchemaChange({
            ...schema,
            properties: schema.properties.filter((x) => x.id !== prop.id),
            views: schema.views.map((v) => (v.groupBy === prop.id ? { ...v, groupBy: undefined } : v)),
          });
          setOpen(false);
        }}>
          <Trash2 size={14} /> 속성 삭제
        </MenuItem>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------
function BoardView({ schema, view, rows, updateRow, addRow, addOption }: RowOps & { schema: DbSchema; view: DbView }) {
  const { workspace, members, canEdit } = useWorkspace();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const groupProp = schema.properties.find((p) => p.id === view.groupBy);

  if (!groupProp) {
    return <div className="py-10 text-center text-sm text-muted">뷰 설정(⋯)에서 그룹 기준 속성을 선택하세요.</div>;
  }

  const columns: { id: string; name: string; tag?: PropOption }[] =
    groupProp.type === "person"
      ? members.map((m) => ({ id: m.user_id, name: m.profile.display_name }))
      : (groupProp.options ?? []).map((o) => ({ id: o.id, name: o.name, tag: o }));
  columns.push({ id: "__none", name: `${groupProp.name} 없음` });

  const cardProps = schema.properties.filter((p) => p.id !== groupProp.id).slice(0, 3);

  return (
    <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-4 pt-3">
      {columns.map((col) => {
        const items = rows.filter((r) => {
          const v = r.properties[groupProp.id];
          return col.id === "__none" ? !v || !columns.some((c) => c.id === v) : v === col.id;
        });
        return (
          <div
            key={col.id}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(col.id); } }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              setDragOver(null);
              const id = e.dataTransfer.getData("text/row-id");
              if (id) void updateRow(id, { properties: { [groupProp.id]: col.id === "__none" ? null : col.id } });
            }}
            className={`w-64 shrink-0 rounded-lg p-1.5 ${dragOver === col.id ? "bg-accent/10" : "bg-hover/40"}`}
          >
            <div className="mb-2 flex items-center gap-2 px-1 text-sm">
              {col.tag ? <Tag name={col.tag.name} color={col.tag.color} /> : <span className="text-muted">{col.name}</span>}
              <span className="text-xs text-muted">{items.length}</span>
            </div>
            <div className="space-y-1.5">
              {items.map((r) => (
                <Link
                  key={r.id}
                  href={`/w/${workspace.id}/p/${r.id}`}
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData("text/row-id", r.id)}
                  className="block rounded-md border border-line bg-background p-2 shadow-sm hover:bg-hover"
                >
                  <div className="text-sm font-medium">{r.icon} {r.title || "제목 없음"}</div>
                  <div className="mt-1 flex flex-wrap gap-1" onClick={(e) => e.preventDefault()}>
                    {cardProps.map((p) => {
                      const v = r.properties[p.id];
                      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
                      return (
                        <div key={p.id} className="max-w-full">
                          <PropertyCell compact prop={p} value={v} members={members} canEdit={false} onAddOption={addOption} onChange={() => {}} />
                        </div>
                      );
                    })}
                  </div>
                </Link>
              ))}
            </div>
            {canEdit && (
              <button
                onClick={() => addRow(col.id === "__none" ? {} : { [groupProp.id]: col.id }, true)}
                className="mt-1 flex w-full items-center gap-1 rounded px-2 py-1 text-sm text-muted hover:bg-hover"
              >
                <Plus size={14} /> 새로 만들기
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
